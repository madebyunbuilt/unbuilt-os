import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { getClient, recordActivity, text } from './lib/crm';
import { recordUpload } from './lib/files';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { portalAppOrigin } from './lib/hosts';
import {
  FX_RATE_MAX_AGE_DAYS,
  INVOICE_TYPES,
  OPEN_STATUSES,
  TYPE_LABELS,
  addDays,
  checkedDiscount,
  checkedLines,
  checkedTax,
  checkedTerms,
  discountValidator,
  getInvoice,
  invoiceError,
  invoiceRecipients,
  invoiceTotals,
  latestFxRate,
  lineItemValidator,
  paymentTermsFor,
  settle,
  studioToday,
  taxDefaultsFor,
} from './lib/invoices';
import { type Currency, formatBpsAsPercent, formatMoney, MICRO_PER_UNIT } from './lib/money';
import { nextNumber } from './lib/numbering';
import { notifyTeamMembers } from './lib/notify';
import { getOrgSettings } from './lib/settings';
import { type InvoicePdfPayload } from '../pdf/types';

// Invoices (08-billing-and-finance.md, Invoices). Drafts are edited freely; sending numbers the invoice, freezes its
// lines, totals and FX rate, renders the PDF and emails it, in the order the spec sets out. A sent invoice never
// changes: corrections are credit notes, or a void while nothing has been paid or credited against it.

type Ctx = QueryCtx | MutationCtx;

const invoiceType = v.union(...INVOICE_TYPES.map((type) => v.literal(type)));
const currencyValidator = v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'));
const taxValidator = v.object({ applies: v.boolean(), bps: v.number() });

async function invoiceView(ctx: Ctx, invoice: Doc<'invoices'>) {
  const [client, project] = await Promise.all([
    ctx.db.get('clients', invoice.clientId),
    invoice.projectId ? ctx.db.get('projects', invoice.projectId) : null,
  ]);
  return {
    id: invoice._id,
    number: invoice.number,
    type: invoice.type,
    typeLabel: TYPE_LABELS[invoice.type],
    status: invoice.status,
    clientId: invoice.clientId,
    clientName: client?.displayName ?? 'Unknown client',
    projectId: invoice.projectId,
    projectName: project?.name,
    currency: invoice.currency,
    fxRateToNgnMicro: invoice.fxRateToNgnMicro,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentTermsDays: invoice.paymentTermsDays,
    totals: invoice.totals,
    paidMinor: invoice.paidMinor,
    whtCreditedMinor: invoice.whtCreditedMinor,
    creditedMinor: invoice.creditedMinor,
    balanceMinor: invoice.balanceMinor,
    sentAt: invoice.sentAt,
    createdAt: invoice._creationTime,
  };
}

export const list = teamQuery('invoices.view')({
  args: {
    status: v.optional(v.string()),
    clientId: v.optional(v.id('clients')),
  },
  handler: async (ctx, { status, clientId }) => {
    const invoices = clientId
      ? await ctx.db
          .query('invoices')
          .withIndex('by_client_status', (q) => q.eq('clientId', clientId))
          .collect()
      : await ctx.db.query('invoices').order('desc').take(1000);
    const views = await Promise.all(
      invoices
        .filter((invoice) =>
          !status || status === 'all'
            ? true
            : status === 'open'
              ? OPEN_STATUSES.has(invoice.status)
              : invoice.status === status,
        )
        .map((invoice) => invoiceView(ctx, invoice)),
    );
    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const get = teamQuery('invoices.view')({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, { invoiceId }) => {
    const invoice = await getInvoice(ctx, invoiceId);
    const creator = await ctx.db.get('teamMembers', invoice.createdByMemberId);
    return {
      ...(await invoiceView(ctx, invoice)),
      lineItems: invoice.lineItems,
      discount: invoice.discount,
      vat: invoice.vat,
      wht: invoice.wht,
      fxRateOverridden: invoice.fxRateOverridden ?? false,
      notes: invoice.notes,
      terms: invoice.terms,
      pdfFileId: invoice.pdfFileId,
      pdfSha256: invoice.pdfSha256,
      recipientContactIds: invoice.recipientContactIds,
      voidReason: invoice.voidReason,
      voidedAt: invoice.voidedAt,
      paidAt: invoice.paidAt,
      writtenOffMinor: invoice.writtenOffMinor,
      writeOffReason: invoice.writeOffReason,
      noReminders: invoice.noReminders ?? false,
      createdByName: creator?.name ?? 'Former member',
    };
  },
});

/** What a new invoice for this client would charge: its VAT treatment, WHT and payment terms, before anything is typed. */
export const defaultsFor = teamQuery('invoices.create')({
  args: { clientId: v.id('clients') },
  handler: async (ctx, { clientId }) => {
    const client = await getClient(ctx, clientId);
    return {
      ...(await taxDefaultsFor(ctx, client)),
      paymentTermsDays: await paymentTermsFor(ctx, client),
      currency: client.defaultCurrency,
    };
  },
});

// Drafts --------------------------------------------------------------------------------------------------------------

const draftFields = {
  lineItems: v.array(lineItemValidator),
  discount: v.optional(discountValidator),
  vat: v.optional(taxValidator),
  wht: v.optional(taxValidator),
  paymentTermsDays: v.optional(v.number()),
  fxRateToNgnMicro: v.optional(v.number()),
  notes: v.optional(v.string()),
  terms: v.optional(v.string()),
};

function checkedRate(currency: Currency, rate: number | undefined) {
  if (rate === undefined || currency === 'NGN') return undefined;
  if (!Number.isSafeInteger(rate) || rate <= 0) {
    throw invoiceError('invoices.invalid', 'The exchange rate must be a positive number of naira');
  }
  return rate;
}

export const create = teamMutation('invoices.create')({
  args: {
    clientId: v.id('clients'),
    projectId: v.optional(v.id('projects')),
    type: v.optional(invoiceType),
    currency: v.optional(currencyValidator),
    ...draftFields,
  },
  handler: async (ctx, args) => {
    const client = await getClient(ctx, args.clientId);
    if (args.projectId) {
      const project = await ctx.db.get('projects', args.projectId);
      if (!project || project.clientId !== client._id) {
        throw invoiceError('invoices.invalid', 'That project belongs to another client');
      }
    }
    const currency = args.currency ?? client.defaultCurrency;
    const defaults = await taxDefaultsFor(ctx, client);
    const discount = checkedDiscount(args.discount);
    const vat = checkedTax(args.vat ?? defaults.vat, 'VAT');
    const wht = checkedTax(args.wht ?? defaults.wht, 'WHT');
    const { lineItems, totals } = invoiceTotals(checkedLines(args.lineItems), discount, vat, wht);
    const rate = checkedRate(currency, args.fxRateToNgnMicro);
    const latest = await latestFxRate(ctx, currency);

    const invoiceId = await ctx.db.insert('invoices', {
      clientId: client._id,
      projectId: args.projectId,
      type: args.type ?? 'standard',
      status: 'draft',
      paymentTermsDays: checkedTerms(args.paymentTermsDays ?? (await paymentTermsFor(ctx, client))),
      currency,
      fxRateToNgnMicro: rate ?? latest?.rateToNgnMicro ?? (currency === 'NGN' ? MICRO_PER_UNIT : 0),
      fxRateOverridden: rate !== undefined,
      lineItems,
      discount,
      vat,
      wht,
      totals,
      paidMinor: 0,
      whtCreditedMinor: 0,
      creditedMinor: 0,
      balanceMinor: totals.totalMinor,
      reminders: [],
      notes: text(args.notes, 'Notes', { max: 2000 }),
      terms: text(args.terms, 'Terms', { max: 2000 }),
      createdByMemberId: ctx.principal.member._id,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: client._id },
      clientId: client._id,
      type: 'system',
      title: `Invoice drafted for ${client.displayName}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId },
    });
    return invoiceId;
  },
});

function assertDraft(invoice: Doc<'invoices'>) {
  if (invoice.status !== 'draft') {
    throw invoiceError(
      'invoices.notDraft',
      'A sent invoice cannot change. Issue a credit note, or void it if nothing has been paid.',
    );
  }
}

export const update = teamMutation('invoices.update')({
  args: { invoiceId: v.id('invoices'), ...draftFields },
  handler: async (ctx, { invoiceId, ...args }) => {
    const invoice = await getInvoice(ctx, invoiceId);
    assertDraft(invoice);
    const discount = checkedDiscount(args.discount);
    const vat = checkedTax(args.vat ?? invoice.vat, 'VAT');
    const wht = checkedTax(args.wht ?? invoice.wht, 'WHT');
    const { lineItems, totals } = invoiceTotals(checkedLines(args.lineItems), discount, vat, wht);
    const rate = checkedRate(invoice.currency, args.fxRateToNgnMicro);
    const latest = rate === undefined ? await latestFxRate(ctx, invoice.currency) : null;
    await ctx.db.patch('invoices', invoiceId, {
      lineItems,
      discount,
      vat,
      wht,
      totals,
      balanceMinor: totals.totalMinor,
      paymentTermsDays: checkedTerms(args.paymentTermsDays ?? invoice.paymentTermsDays),
      fxRateToNgnMicro: rate ?? latest?.rateToNgnMicro ?? invoice.fxRateToNgnMicro,
      fxRateOverridden: rate !== undefined,
      notes: text(args.notes, 'Notes', { max: 2000 }),
      terms: text(args.terms, 'Terms', { max: 2000 }),
    });
  },
});

/** A draft that was never numbered can be deleted; anything numbered stays on record and is voided instead. */
export const remove = teamMutation('invoices.update')({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, { invoiceId }) => {
    const invoice = await getInvoice(ctx, invoiceId);
    assertDraft(invoice);
    if (invoice.number) {
      throw invoiceError('invoices.numbered', 'This invoice has a number, so it stays on record. Void it instead.');
    }
    await ctx.db.delete('invoices', invoiceId);
  },
});

// Sending -------------------------------------------------------------------------------------------------------------

/** A USD or EUR invoice needs a rate from the last week before it can go out. */
async function assertFreshRate(ctx: Ctx, currency: Currency) {
  if (currency === 'NGN') return;
  const latest = await latestFxRate(ctx, currency);
  const freshFrom = addDays(await studioToday(ctx), -FX_RATE_MAX_AGE_DAYS);
  if (!latest?.date || latest.date < freshFrom) {
    throw invoiceError(
      'invoices.staleRate',
      `Update the ${currency} exchange rate first: the last one is older than ${FX_RATE_MAX_AGE_DAYS} days`,
    );
  }
}

/**
 * Checks the send while the person is still looking at it, then hands it to the action in convex/invoiceSending.ts,
 * which renders the PDF and emails it.
 */
export const send = teamMutation('invoices.send')({
  args: {
    invoiceId: v.id('invoices'),
    contactIds: v.optional(v.array(v.id('contacts'))),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await getInvoice(ctx, args.invoiceId);
    if (invoice.status !== 'draft' && invoice.status !== 'scheduled') {
      throw invoiceError('invoices.notDraft', 'This invoice has already been sent');
    }
    if (invoice.lineItems.length === 0 || invoice.totals.totalMinor === 0) {
      throw invoiceError('invoices.empty', 'Add at least one line with an amount before sending');
    }
    await assertFreshRate(ctx, invoice.currency);
    const recipients = await invoiceRecipients(ctx, invoice.clientId, args.contactIds);
    if (recipients.length === 0) {
      throw invoiceError('invoices.noRecipients', 'Add a billing contact with an email address to send this to');
    }
    await ctx.scheduler.runAfter(0, internal.invoiceSending.send, {
      invoiceId: invoice._id,
      memberId: ctx.principal.member._id,
      contactIds: args.contactIds,
      message: text(args.message, 'Message', { max: 2000 }),
    });
    return { sendingTo: recipients.map((recipient) => recipient.email) };
  },
});

const longDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(Date.parse(`${value}T00:00:00Z`));

/**
 * Numbers the invoice (once; a retry keeps the number), sets its dates, freezes its rate, and returns what the PDF and
 * the email need. The invoice stays a draft until the email is away.
 */
export const prepareSend = internalMutation({
  args: {
    invoiceId: v.id('invoices'),
    memberId: v.id('teamMembers'),
    contactIds: v.optional(v.array(v.id('contacts'))),
  },
  handler: async (ctx, args) => {
    const invoice = await getInvoice(ctx, args.invoiceId);
    if (invoice.status !== 'draft' && invoice.status !== 'scheduled') {
      throw invoiceError('invoices.notDraft', 'This invoice has already been sent');
    }
    await assertFreshRate(ctx, invoice.currency);
    const recipients = await invoiceRecipients(ctx, invoice.clientId, args.contactIds);
    if (recipients.length === 0) {
      throw invoiceError('invoices.noRecipients', 'Add a billing contact with an email address to send this to');
    }
    const client = await getClient(ctx, invoice.clientId);
    const settings = await getOrgSettings(ctx);

    const number = invoice.number ?? (await nextNumber(ctx, 'invoice'));
    const issueDate = await studioToday(ctx);
    const dueDate = addDays(issueDate, invoice.paymentTermsDays);
    const fxRateToNgnMicro =
      invoice.currency === 'NGN'
        ? MICRO_PER_UNIT
        : invoice.fxRateOverridden
          ? invoice.fxRateToNgnMicro
          : (await latestFxRate(ctx, invoice.currency))!.rateToNgnMicro;
    // Worked out once more from the lines, so what is frozen is exactly what money.ts says.
    const { lineItems, totals } = invoiceTotals(
      invoice.lineItems,
      invoice.discount as Parameters<typeof invoiceTotals>[1],
      invoice.vat,
      invoice.wht,
    );
    await ctx.db.patch('invoices', invoice._id, {
      number,
      issueDate,
      dueDate,
      fxRateToNgnMicro,
      lineItems,
      totals,
      balanceMinor: totals.totalMinor - invoice.paidMinor - invoice.whtCreditedMinor - invoice.creditedMinor,
    });

    const sender = await ctx.db.get('teamMembers', args.memberId);
    const pdf: InvoicePdfPayload = {
      number,
      typeLabel: TYPE_LABELS[invoice.type],
      issueDate: longDate(issueDate),
      dueDate: longDate(dueDate),
      currency: invoice.currency,
      org: {
        name: settings.legalName ?? settings.tradingName ?? 'Unbuilt Studio',
        addressLines: settings.addressLines,
        email: settings.email,
        phone: settings.phone,
        website: settings.website,
        tin: settings.tin,
        vatNumber: settings.vatNumber,
      },
      client: {
        name: client.legalName ?? client.displayName,
        addressLines: client.addressLines ?? [],
        tin: client.tin,
      },
      lineItems: lineItems.map((line) => ({
        description: line.description,
        quantityMilli: line.quantityMilli,
        unitPriceMinor: line.unitPriceMinor,
        amountMinor: line.amountMinor,
        taxable: line.taxable,
      })),
      totals,
      vat: invoice.vat,
      vatTreatment: client.vatTreatment ?? 'standard',
      wht: invoice.wht,
      bankAccounts: settings.bankAccounts
        .filter((account) => account.currency === invoice.currency)
        .map(({ label, bankName, accountName, accountNumber, swift, iban }) => ({
          label,
          bankName,
          accountName,
          accountNumber,
          swift,
          iban,
        })),
      notes: invoice.notes,
      terms: invoice.terms,
      footer: settings.invoiceFooter,
      brand: settings.brand,
      // The issue day, so re-rendering the same invoice gives the same bytes.
      createdAtMs: Date.parse(`${issueDate}T00:00:00Z`),
    };
    return {
      number,
      pdf,
      recipients,
      clientName: client.displayName,
      studioName: pdf.org.name,
      senderName: sender?.name ?? pdf.org.name,
      typeLabel: TYPE_LABELS[invoice.type],
      totalMinor: totals.totalMinor,
      currency: invoice.currency,
      dueDate: longDate(dueDate),
      bankAccounts: pdf.bankAccounts,
      // Only for a client who withholds tax, and in their own figures.
      whtNote:
        invoice.wht.applies && totals.whtExpectedMinor > 0
          ? `If you withhold tax at ${formatBpsAsPercent(invoice.wht.bps)}% (${formatMoney(totals.whtExpectedMinor, invoice.currency)}), please pay ${formatMoney(totals.totalMinor - totals.whtExpectedMinor, invoice.currency)} and send us the WHT certificate.`
          : undefined,
      portalUrl: `${portalAppOrigin() ?? ''}/invoices/${invoice._id}`,
    };
  },
});

/** The stored PDF, checked and recorded like any other upload, on the invoice, for the client to read too. */
export const attachPdf = internalMutation({
  args: {
    invoiceId: v.id('invoices'),
    storageId: v.id('_storage'),
    fileName: v.string(),
    memberId: v.id('teamMembers'),
  },
  handler: async (ctx, args): Promise<{ ok: true; sha256: string } | { ok: false; message: string }> => {
    const invoice = await getInvoice(ctx, args.invoiceId);
    const upload = await recordUpload(ctx, {
      storageId: args.storageId,
      name: args.fileName,
      contentType: 'application/pdf',
      context: 'document',
      owner: { table: 'invoices', id: invoice._id },
      visibility: 'client',
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      uploadedBy: { kind: 'team', id: args.memberId },
    });
    if (!upload.ok) return { ok: false, message: upload.message };
    const file = (await ctx.db.get('files', upload.fileId))!;
    await ctx.db.patch('invoices', invoice._id, { pdfFileId: file._id, pdfSha256: file.sha256 });
    return { ok: true, sha256: file.sha256 };
  },
});

/** The email is away: the invoice is now out with the client, and no longer changes. */
export const markSent = internalMutation({
  args: { invoiceId: v.id('invoices'), memberId: v.id('teamMembers'), recipientContactIds: v.array(v.id('contacts')) },
  handler: async (ctx, { invoiceId, memberId, recipientContactIds }) => {
    const invoice = await getInvoice(ctx, invoiceId);
    const now = Date.now();
    await ctx.db.patch('invoices', invoiceId, { status: 'sent', sentAt: now, recipientContactIds });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'system',
      title: `${invoice.number} sent`,
      actor: { kind: 'team', id: memberId },
      meta: { invoiceId },
    });
  },
});

export const reportSendFailed = internalMutation({
  args: { invoiceId: v.id('invoices'), memberId: v.id('teamMembers'), reason: v.string() },
  handler: async (ctx, { invoiceId, memberId, reason }) => {
    const invoice = await ctx.db.get('invoices', invoiceId);
    await notifyTeamMembers(ctx, [memberId], {
      event: 'invoice_send_failed',
      title: `${invoice?.number ?? 'An invoice'} did not go out`,
      body: reason.slice(0, 300),
      link: `/invoices/${invoiceId}`,
    });
  },
});

// Void ----------------------------------------------------------------------------------------------------------------

/**
 * Voids a sent invoice that nothing has been paid, credited or recorded as WHT against (decided by the studio,
 * 2026-09-22). It keeps its number and stays on record. Anything with money on it is corrected with a credit note.
 */
export const voidInvoice = teamMutation('invoices.void')({
  args: { invoiceId: v.id('invoices'), reason: v.string() },
  handler: async (ctx, { invoiceId, reason }) => {
    const invoice = await getInvoice(ctx, invoiceId);
    if (invoice.status === 'draft' || invoice.status === 'scheduled') {
      throw invoiceError('invoices.notSent', 'A draft is deleted, not voided');
    }
    if (!OPEN_STATUSES.has(invoice.status)) {
      throw invoiceError('invoices.closed', `A ${invoice.status.replace('_', ' ')} invoice cannot be voided`);
    }
    if (invoice.paidMinor > 0 || invoice.whtCreditedMinor > 0 || invoice.creditedMinor > 0) {
      throw invoiceError(
        'invoices.hasMoney',
        'Money has been paid or credited against this invoice. Issue a credit note instead.',
      );
    }
    const why = text(reason, 'Reason', { required: true, max: 500 })!;
    await ctx.db.patch('invoices', invoiceId, {
      status: 'void',
      voidReason: why,
      voidedAt: Date.now(),
      balanceMinor: 0,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'status_change',
      title: `${invoice.number} voided`,
      body: why,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId },
    });
  },
});

// Write-offs -----------------------------------------------------------------------------------------------------------

/** Gives up on what is still owed: the balance moves to bad debt, keeping every payment already made. */
export const writeOff = teamMutation('invoices.writeoff')({
  args: { invoiceId: v.id('invoices'), reason: v.string() },
  handler: async (ctx, { invoiceId, reason }) => {
    const invoice = await getInvoice(ctx, invoiceId);
    if (!OPEN_STATUSES.has(invoice.status) || invoice.balanceMinor === 0) {
      throw invoiceError('invoices.notOpen', 'Only an invoice with money still owed can be written off');
    }
    const why = text(reason, 'Reason', { required: true, max: 500 })!;
    await ctx.db.patch('invoices', invoiceId, {
      status: 'written_off',
      writtenOffMinor: invoice.balanceMinor,
      writeOffReason: why,
      writtenOffAt: Date.now(),
      balanceMinor: 0,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'status_change',
      title: `${invoice.number} written off`,
      body: why,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId, writtenOffMinor: invoice.balanceMinor },
    });
  },
});

/** Undoes a write-off, for when the client pays after all: the balance is owed again. */
export const reverseWriteOff = teamMutation('invoices.writeoff')({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, { invoiceId }) => {
    const invoice = await getInvoice(ctx, invoiceId);
    if (invoice.status !== 'written_off')
      throw invoiceError('invoices.notWrittenOff', 'This invoice is not written off');
    await ctx.db.patch('invoices', invoiceId, {
      ...(await settle(ctx, invoice, {
        paidMinor: invoice.paidMinor,
        whtCreditedMinor: invoice.whtCreditedMinor,
        creditedMinor: invoice.creditedMinor,
      })),
      writtenOffMinor: undefined,
      writeOffReason: undefined,
      writtenOffAt: undefined,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'status_change',
      title: `${invoice.number} write-off reversed`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId },
    });
  },
});
