import { v } from 'convex/values';
import { internal } from './_generated/api';
import { recordActivity, text } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { getInvoice, invoiceError, settle, studioToday } from './lib/invoices';
import { calculateTotals, creditNoteVatSplit, formatMoney, maxCreditNoteMinor, splitCredit } from './lib/money';
import { nextNumber } from './lib/numbering';

// Credit notes and held credit (08-billing-and-finance.md, Credit notes; decisions of 2026-09-22). A credit note
// corrects what an invoice charged. Its amount includes VAT in the invoice's own proportion. The part that fits what
// the invoice still owes is applied to it; anything more (because the client had already paid) is held as the client's
// credit, which Finance applies to a later invoice in the same currency by hand, or refunds.

/** Invoices a credit note can be raised against: sent, whether or not anything has been paid. */
const CREDITABLE = new Set(['sent', 'viewed', 'partially_paid', 'paid', 'overdue']);

const lineValidator = v.object({ description: v.string(), quantityMilli: v.number(), unitPriceMinor: v.number() });

export const create = teamMutation('creditnotes.create')({
  args: {
    invoiceId: v.id('invoices'),
    reason: v.string(),
    // Either the lines being credited (priced as on the invoice, with its VAT), or one amount including VAT.
    lineItems: v.optional(v.array(lineValidator)),
    amountMinor: v.optional(v.number()),
    emailCreditNote: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const invoice = await getInvoice(ctx, args.invoiceId);
    if (!CREDITABLE.has(invoice.status)) {
      throw invoiceError(
        'invoices.notCreditable',
        invoice.status === 'written_off'
          ? 'This invoice was written off. Reverse the write-off first.'
          : `A ${invoice.status} invoice cannot be credited`,
      );
    }
    const reason = text(args.reason, 'Reason', { required: true, max: 500 })!;

    let lineItems: { description: string; quantityMilli: number; unitPriceMinor: number; amountMinor: number }[];
    let netMinor: number;
    let vatMinor: number;
    if (args.lineItems?.length) {
      if (args.amountMinor !== undefined) {
        throw invoiceError('invoices.invalid', 'Credit either lines or an amount, not both');
      }
      const lines = args.lineItems.map((line) => {
        if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0) {
          throw invoiceError('invoices.invalid', 'Each line needs a quantity above zero');
        }
        if (!Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) {
          throw invoiceError('invoices.invalid', 'Each line needs a whole, non-negative price');
        }
        return { ...line, description: text(line.description, 'Line description', { required: true, max: 500 })! };
      });
      // The invoice's own VAT rate, on the lines as the invoice taxed them (all taxable unless it charged none).
      const { lineAmountsMinor, totals } = calculateTotals({
        lines: lines.map((line) => ({ ...line, taxable: true })),
        discount: { kind: 'none' },
        vat: invoice.vat,
        wht: { applies: false, bps: 0 },
      });
      lineItems = lines.map((line, index) => ({ ...line, amountMinor: lineAmountsMinor[index] }));
      netMinor = totals.subtotalMinor;
      vatMinor = totals.vatMinor;
    } else {
      const amount = args.amountMinor;
      if (amount === undefined || !Number.isSafeInteger(amount) || amount <= 0) {
        throw invoiceError('invoices.invalid', 'Enter the amount to credit, or the lines');
      }
      ({ netMinor, vatMinor } = creditNoteVatSplit(amount, invoice.totals));
      lineItems = [
        {
          description: `Credit against ${invoice.number}`,
          quantityMilli: 1_000,
          unitPriceMinor: netMinor,
          amountMinor: netMinor,
        },
      ];
    }
    const amountMinor = netMinor + vatMinor;

    const existing = await ctx.db
      .query('creditNotes')
      .withIndex('by_invoice', (q) => q.eq('invoiceId', invoice._id))
      .collect();
    const allowed = maxCreditNoteMinor(
      invoice.totals.totalMinor,
      existing.reduce((sum, note) => sum + note.amountMinor, 0),
    );
    if (amountMinor > allowed) {
      throw invoiceError(
        'invoices.overCredit',
        `At most ${formatMoney(allowed, invoice.currency)} more can be credited on this invoice`,
      );
    }

    const { appliedMinor, heldMinor } = splitCredit(amountMinor, invoice.balanceMinor);
    const creditNoteId = await ctx.db.insert('creditNotes', {
      number: await nextNumber(ctx, 'creditNote'),
      invoiceId: invoice._id,
      clientId: invoice.clientId,
      currency: invoice.currency,
      issueDate: await studioToday(ctx),
      reason,
      lineItems,
      netMinor,
      vatMinor,
      amountMinor,
      appliedToInvoiceMinor: appliedMinor,
      heldMinor,
      status: heldMinor > 0 ? 'issued' : 'applied',
      fxRateToNgnMicro: invoice.fxRateToNgnMicro,
      createdByMemberId: ctx.principal.member._id,
    });
    if (appliedMinor > 0) {
      await ctx.db.patch(
        'invoices',
        invoice._id,
        await settle(ctx, invoice, {
          paidMinor: invoice.paidMinor,
          whtCreditedMinor: invoice.whtCreditedMinor,
          creditedMinor: invoice.creditedMinor + appliedMinor,
        }),
      );
    }
    if (heldMinor > 0) {
      await ctx.db.insert('clientCredits', {
        clientId: invoice.clientId,
        currency: invoice.currency,
        creditNoteId,
        amountMinor: heldMinor,
        remainingMinor: heldMinor,
      });
    }
    await ctx.scheduler.runAfter(0, internal.financeSending.sendCreditNote, {
      creditNoteId,
      memberId: ctx.principal.member._id,
      email: args.emailCreditNote ?? true,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'payment_event',
      title: `${formatMoney(amountMinor, invoice.currency)} credited on ${invoice.number}`,
      body: heldMinor > 0 ? `${reason} ${formatMoney(heldMinor, invoice.currency)} held as client credit.` : reason,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId: invoice._id, creditNoteId },
    });
    return creditNoteId;
  },
});

export const forInvoice = teamQuery('invoices.view')({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, { invoiceId }) => {
    await getInvoice(ctx, invoiceId);
    const [notes, applications] = await Promise.all([
      ctx.db
        .query('creditNotes')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect(),
      ctx.db
        .query('creditApplications')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect(),
    ]);
    return {
      creditNotes: notes.map((note) => ({
        id: note._id,
        number: note.number,
        issueDate: note.issueDate,
        reason: note.reason,
        amountMinor: note.amountMinor,
        vatMinor: note.vatMinor,
        appliedToInvoiceMinor: note.appliedToInvoiceMinor,
        heldMinor: note.heldMinor,
        pdfFileId: note.pdfFileId,
        sentAt: note.sentAt,
      })),
      appliedCredit: applications.map((row) => ({
        id: row._id,
        amountMinor: row.amountMinor,
        appliedAt: row.appliedAt,
      })),
    };
  },
});

/** A client's held credit, per currency, with where each piece came from. */
export const forClient = teamQuery('invoices.view')({
  args: { clientId: v.id('clients') },
  handler: async (ctx, { clientId }) => {
    const credits = await ctx.db
      .query('clientCredits')
      .withIndex('by_client', (q) => q.eq('clientId', clientId))
      .collect();
    return await Promise.all(
      credits
        .filter((credit) => credit.remainingMinor > 0)
        .map(async (credit) => ({
          id: credit._id,
          currency: credit.currency,
          amountMinor: credit.amountMinor,
          remainingMinor: credit.remainingMinor,
          creditNoteNumber: (await ctx.db.get('creditNotes', credit.creditNoteId))?.number,
        })),
    );
  },
});

/** Applies held credit to another open invoice of the same client, in the same currency. */
export const apply = teamMutation('payments.record')({
  args: { clientCreditId: v.id('clientCredits'), invoiceId: v.id('invoices'), amountMinor: v.number() },
  handler: async (ctx, { clientCreditId, invoiceId, amountMinor }) => {
    const credit = await ctx.db.get('clientCredits', clientCreditId);
    if (!credit) throw invoiceError('invoices.notFound', 'Credit not found');
    const invoice = await getInvoice(ctx, invoiceId);
    if (invoice.clientId !== credit.clientId) {
      throw invoiceError('invoices.invalid', 'That invoice belongs to another client');
    }
    if (invoice.currency !== credit.currency) {
      throw invoiceError(
        'invoices.invalid',
        `This credit is in ${credit.currency}; the invoice is in ${invoice.currency}`,
      );
    }
    if (!['sent', 'viewed', 'partially_paid', 'overdue'].includes(invoice.status)) {
      throw invoiceError('invoices.notOpen', `A ${invoice.status.replace('_', ' ')} invoice takes no more credit`);
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw invoiceError('invoices.invalid', 'The amount must be positive');
    }
    const most = Math.min(credit.remainingMinor, invoice.balanceMinor);
    if (amountMinor > most) {
      throw invoiceError('invoices.overCredit', `At most ${formatMoney(most, credit.currency)} can be applied here`);
    }
    await ctx.db.patch('clientCredits', credit._id, { remainingMinor: credit.remainingMinor - amountMinor });
    await ctx.db.insert('creditApplications', {
      clientCreditId: credit._id,
      invoiceId: invoice._id,
      clientId: invoice.clientId,
      amountMinor,
      appliedByMemberId: ctx.principal.member._id,
      appliedAt: Date.now(),
    });
    await ctx.db.patch(
      'invoices',
      invoice._id,
      await settle(ctx, invoice, {
        paidMinor: invoice.paidMinor,
        whtCreditedMinor: invoice.whtCreditedMinor,
        creditedMinor: invoice.creditedMinor + amountMinor,
      }),
    );
    if (credit.remainingMinor === amountMinor) {
      await ctx.db.patch('creditNotes', credit.creditNoteId, { status: 'applied' });
    }
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'payment_event',
      title: `${formatMoney(amountMinor, credit.currency)} of held credit applied to ${invoice.number}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId: invoice._id, clientCreditId: credit._id },
    });
  },
});

/** Pays held credit back to the client. No invoice changes: the credit note already corrected it. */
export const refund = teamMutation('payments.refund')({
  args: {
    clientCreditId: v.id('clientCredits'),
    amountMinor: v.number(),
    method: v.union(v.literal('bank_transfer'), v.literal('cash'), v.literal('other')),
    reference: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const credit = await ctx.db.get('clientCredits', args.clientCreditId);
    if (!credit) throw invoiceError('invoices.notFound', 'Credit not found');
    if (!Number.isSafeInteger(args.amountMinor) || args.amountMinor <= 0 || args.amountMinor > credit.remainingMinor) {
      throw invoiceError(
        'invoices.overRefund',
        `At most ${formatMoney(credit.remainingMinor, credit.currency)} of this credit can be refunded`,
      );
    }
    const reason = text(args.reason, 'Reason', { required: true, max: 500 })!;
    await ctx.db.patch('clientCredits', credit._id, { remainingMinor: credit.remainingMinor - args.amountMinor });
    await ctx.db.insert('refunds', {
      clientCreditId: credit._id,
      clientId: credit.clientId,
      amountMinor: args.amountMinor,
      currency: credit.currency,
      reason,
      method: args.method,
      reference: text(args.reference, 'Reference', { max: 120 }),
      status: 'processed',
      processedAt: Date.now(),
      recordedByMemberId: ctx.principal.member._id,
    });
    if (credit.remainingMinor === args.amountMinor) {
      await ctx.db.patch('creditNotes', credit.creditNoteId, { status: 'refunded' });
    }
    await recordActivity(ctx, {
      subject: { table: 'clients', id: credit.clientId },
      clientId: credit.clientId,
      type: 'payment_event',
      title: `${formatMoney(args.amountMinor, credit.currency)} of held credit refunded`,
      body: reason,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { clientCreditId: credit._id },
    });
  },
});
