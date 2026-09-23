import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type QueryCtx } from './_generated/server';
import { recordUpload } from './lib/files';
import { internalMutation, internalQuery } from './lib/functions';
import { invoiceRecipients } from './lib/invoices';
import { formatMoney } from './lib/money';
import { notifyTeamMembers } from './lib/notify';
import { getOrgSettings } from './lib/settings';
import { type CreditNotePdfPayload, type FinanceParties, type ReceiptPdfPayload } from '../pdf/types';

// What the receipt and credit note PDFs and emails need, and where their files are recorded. The rendering runs in
// convex/financeSending.ts, a Node action.

const METHODS: Record<Doc<'payments'>['method'], string> = {
  paystack: 'Card or bank, through Paystack',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  other: 'Other',
};

const longDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(Date.parse(`${value}T00:00:00Z`));

async function parties(ctx: QueryCtx, clientId: Id<'clients'>): Promise<FinanceParties & { studioName: string }> {
  const [settings, client] = await Promise.all([getOrgSettings(ctx), ctx.db.get('clients', clientId)]);
  const name = settings.legalName ?? settings.tradingName ?? 'Unbuilt Studio';
  return {
    studioName: name,
    org: {
      name,
      addressLines: settings.addressLines,
      email: settings.email,
      tin: settings.tin,
      vatNumber: settings.vatNumber,
    },
    client: {
      name: client?.legalName ?? client?.displayName ?? 'Client',
      addressLines: client?.addressLines ?? [],
      tin: client?.tin,
    },
    brand: { primary: settings.brand.primary },
  };
}

export const receiptData = internalQuery({
  args: { receiptId: v.id('receipts') },
  handler: async (ctx, { receiptId }) => {
    const receipt = await ctx.db.get('receipts', receiptId);
    if (!receipt) return null;
    const payment = (await ctx.db.get('payments', receipt.paymentId))!;
    const invoice = (await ctx.db.get('invoices', receipt.invoiceId))!;
    const wht = await ctx.db
      .query('whtCredits')
      .withIndex('by_invoice', (q) => q.eq('invoiceId', invoice._id))
      .collect();
    const whtDeductedMinor = wht
      .filter((row) => row.paymentId === payment._id)
      .reduce((s, row) => s + row.amountMinor, 0);
    const { studioName, ...who } = await parties(ctx, receipt.clientId);
    const pdf: ReceiptPdfPayload = {
      ...who,
      number: receipt.number,
      date: longDate(payment.receivedOn),
      currency: payment.currency,
      invoiceNumber: invoice.number ?? '',
      invoiceTotalMinor: invoice.totals.totalMinor,
      amountMinor: payment.amountMinor,
      whtDeductedMinor,
      method: payment.paystackInstrument ?? METHODS[payment.method],
      // The client's own reference: Paystack's transaction id for a card or transfer through them, or the reference
      // the studio recorded for a payment made by hand. Never the internal inv_<id>_<attempt> one.
      reference: payment.method === 'paystack' ? payment.paystackTransactionId : payment.reference,
      balanceAfterMinor: invoice.balanceMinor,
      createdAtMs: receipt._creationTime,
    };
    return {
      pdf,
      number: receipt.number,
      clientId: receipt.clientId,
      studioName,
      email: receipt.emailed,
      recipients: await invoiceRecipients(ctx, receipt.clientId),
      summary: [
        `thank you for your payment of ${formatMoney(payment.amountMinor, payment.currency)} against invoice ${invoice.number}`,
        whtDeductedMinor > 0
          ? `, with ${formatMoney(whtDeductedMinor, payment.currency)} withheld for the tax office`
          : '',
        '. ',
        invoice.balanceMinor === 0
          ? `${invoice.number} is now settled in full.`
          : `${formatMoney(invoice.balanceMinor, invoice.currency)} is still owed on it.`,
      ].join(''),
    };
  },
});

export const creditNoteData = internalQuery({
  args: { creditNoteId: v.id('creditNotes') },
  handler: async (ctx, { creditNoteId }) => {
    const note = await ctx.db.get('creditNotes', creditNoteId);
    if (!note) return null;
    const invoice = (await ctx.db.get('invoices', note.invoiceId))!;
    const { studioName, ...who } = await parties(ctx, note.clientId);
    const pdf: CreditNotePdfPayload = {
      ...who,
      number: note.number,
      date: longDate(note.issueDate),
      currency: note.currency,
      invoiceNumber: invoice.number ?? '',
      reason: note.reason,
      lineItems: note.lineItems,
      netMinor: note.netMinor,
      vatMinor: note.vatMinor,
      vatBps: invoice.vat.bps,
      amountMinor: note.amountMinor,
      appliedToInvoiceMinor: note.appliedToInvoiceMinor,
      heldMinor: note.heldMinor,
      createdAtMs: note._creationTime,
    };
    return {
      pdf,
      number: note.number,
      clientId: note.clientId,
      studioName,
      recipients: await invoiceRecipients(ctx, note.clientId),
      summary: [
        `we have issued a credit of ${formatMoney(note.amountMinor, note.currency)} against invoice ${invoice.number}. `,
        invoice.balanceMinor === 0
          ? `Nothing more is owed on ${invoice.number}.`
          : `${formatMoney(invoice.balanceMinor, invoice.currency)} is still owed on it.`,
        note.heldMinor > 0
          ? ` ${formatMoney(note.heldMinor, note.currency)} is held as your credit, towards a later invoice or to be paid back to you.`
          : '',
      ].join(''),
    };
  },
});

/** Records the rendered PDF on its receipt or credit note, client-visible like the invoice itself. */
export const attachPdf = internalMutation({
  args: {
    receiptId: v.optional(v.id('receipts')),
    creditNoteId: v.optional(v.id('creditNotes')),
    storageId: v.id('_storage'),
    fileName: v.string(),
    memberId: v.id('teamMembers'),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const row = args.receiptId
      ? await ctx.db.get('receipts', args.receiptId)
      : args.creditNoteId
        ? await ctx.db.get('creditNotes', args.creditNoteId)
        : null;
    if (!row) return { ok: false, message: 'Nothing to attach the PDF to' };
    const upload = await recordUpload(ctx, {
      storageId: args.storageId,
      name: args.fileName,
      contentType: 'application/pdf',
      context: 'document',
      owner: { table: args.receiptId ? 'receipts' : 'creditNotes', id: row._id },
      visibility: 'client',
      clientId: row.clientId,
      uploadedBy: { kind: 'team', id: args.memberId },
    });
    if (!upload.ok) return upload;
    const file = (await ctx.db.get('files', upload.fileId))!;
    if (args.receiptId) await ctx.db.patch('receipts', args.receiptId, { pdfFileId: file._id, pdfSha256: file.sha256 });
    if (args.creditNoteId) {
      await ctx.db.patch('creditNotes', args.creditNoteId, { pdfFileId: file._id, pdfSha256: file.sha256 });
    }
    return { ok: true };
  },
});

export const markEmailed = internalMutation({
  args: { receiptId: v.optional(v.id('receipts')), creditNoteId: v.optional(v.id('creditNotes')) },
  handler: async (ctx, { receiptId, creditNoteId }) => {
    if (receiptId) await ctx.db.patch('receipts', receiptId, { sentAt: Date.now() });
    if (creditNoteId) await ctx.db.patch('creditNotes', creditNoteId, { sentAt: Date.now() });
  },
});

export const reportFailed = internalMutation({
  args: { memberId: v.id('teamMembers'), what: v.string(), reason: v.string() },
  handler: async (ctx, { memberId, what, reason }) => {
    await notifyTeamMembers(ctx, [memberId], {
      event: 'finance_document_failed',
      title: `${what} did not go out`,
      body: `${reason.slice(0, 200)} The money is recorded; only the PDF or email is missing.`,
    });
  },
});
