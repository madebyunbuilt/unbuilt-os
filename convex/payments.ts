import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { recordActivity, text } from './lib/crm';
import { recordUpload } from './lib/files';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { assertAcceptsMoney, getInvoice, invoiceError, settle, studioToday } from './lib/invoices';
import { notifyTeamMembers } from './lib/notify';
import { formatMoney } from './lib/money';
import { nextNumber } from './lib/numbering';
import { isIsoDate } from './lib/validation';

// Payments and withholding tax (08-billing-and-finance.md, Payments). A payment and the WHT the client withheld from it
// settle the invoice together; overpayment is refused. Every payment gets a receipt, emailed unless unticked (studio,
// 2026-09-22). A refund gives money back and reopens the invoice's balance. A disputed WHT deduction can be reversed
// onto the balance, with a reason (studio, 2026-09-22). Paystack payments and refunds arrive with step 8.

const method = v.union(v.literal('bank_transfer'), v.literal('cash'), v.literal('other'));

function checkedAmount(value: number, label: string, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw invoiceError('invoices.invalid', `${label} must be a positive amount`);
  }
  return value;
}

async function checkedDay(ctx: MutationCtx, value: string) {
  if (!isIsoDate(value)) throw invoiceError('invoices.invalid', 'The date must be a date');
  if (value > (await studioToday(ctx))) throw invoiceError('invoices.invalid', 'A payment cannot be in the future');
  return value;
}

/** Everything that has moved on an invoice: payments, WHT, refunds and receipts, newest first. */
export const forInvoice = teamQuery('invoices.view')({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, { invoiceId }) => {
    await getInvoice(ctx, invoiceId);
    const [payments, wht, receipts] = await Promise.all([
      ctx.db
        .query('payments')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect(),
      ctx.db
        .query('whtCredits')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect(),
      ctx.db
        .query('receipts')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect(),
    ]);
    const refunds = (
      await Promise.all(
        payments.map((payment) =>
          ctx.db
            .query('refunds')
            .withIndex('by_payment', (q) => q.eq('paymentId', payment._id))
            .collect(),
        ),
      )
    ).flat();
    return {
      payments: payments
        .map((payment) => {
          const receipt = receipts.find((row) => row.paymentId === payment._id);
          return {
            id: payment._id,
            amountMinor: payment.amountMinor,
            refundedMinor: payment.refundedMinor,
            currency: payment.currency,
            method: payment.method,
            instrument: payment.paystackInstrument,
            status: payment.status,
            receivedOn: payment.receivedOn,
            reference: payment.reference,
            notes: payment.notes,
            proofFileId: payment.proofFileId,
            receipt: receipt
              ? { id: receipt._id, number: receipt.number, pdfFileId: receipt.pdfFileId, sentAt: receipt.sentAt }
              : null,
            wht: wht
              .filter((row) => row.paymentId === payment._id)
              .map((row) => ({ id: row._id, amountMinor: row.amountMinor, status: row.status })),
          };
        })
        .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn)),
      whtCredits: wht.map((row) => ({
        id: row._id,
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: row.status,
        certificateNumber: row.certificateNumber,
        certificateFileId: row.certificateFileId,
        receivedAt: row.receivedAt,
        disputeNote: row.disputeNote,
        reversedReason: row.reversedReason,
      })),
      refunds: refunds.map((row) => ({
        id: row._id,
        paymentId: row.paymentId,
        amountMinor: row.amountMinor,
        method: row.method,
        reference: row.reference,
        reason: row.reason,
        processedAt: row.processedAt,
      })),
    };
  },
});

/**
 * Records money received against an invoice, with any WHT the client withheld. Numbers the receipt in the same
 * transaction, and hands the PDF and email to convex/financeSending.ts.
 */
export const record = teamMutation('payments.record')({
  args: {
    invoiceId: v.id('invoices'),
    amountMinor: v.number(),
    whtDeductedMinor: v.optional(v.number()),
    receivedOn: v.string(),
    method,
    reference: v.optional(v.string()),
    notes: v.optional(v.string()),
    emailReceipt: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const invoice = await getInvoice(ctx, args.invoiceId);
    assertAcceptsMoney(invoice);
    const amountMinor = checkedAmount(args.amountMinor, 'The amount');
    const whtMinor = checkedAmount(args.whtDeductedMinor ?? 0, 'The WHT deducted', { allowZero: true });
    if (amountMinor + whtMinor > invoice.balanceMinor) {
      throw invoiceError(
        'invoices.overpaid',
        `That is more than the ${formatMoney(invoice.balanceMinor, invoice.currency)} still owed. Record the exact balance and handle the rest as a credit.`,
      );
    }
    const receivedOn = await checkedDay(ctx, args.receivedOn);

    const paymentId = await ctx.db.insert('payments', {
      invoiceId: invoice._id,
      clientId: invoice.clientId,
      amountMinor,
      currency: invoice.currency,
      method: args.method,
      status: 'succeeded',
      receivedOn,
      reference: text(args.reference, 'Reference', { max: 120 }),
      refundedMinor: 0,
      recordedByMemberId: ctx.principal.member._id,
      notes: text(args.notes, 'Notes', { max: 1000 }),
    });
    if (whtMinor > 0) {
      await ctx.db.insert('whtCredits', {
        invoiceId: invoice._id,
        clientId: invoice.clientId,
        paymentId,
        amountMinor: whtMinor,
        currency: invoice.currency,
        status: 'expected',
      });
    }
    await ctx.db.patch(
      'invoices',
      invoice._id,
      await settle(ctx, invoice, {
        paidMinor: invoice.paidMinor + amountMinor,
        whtCreditedMinor: invoice.whtCreditedMinor + whtMinor,
        creditedMinor: invoice.creditedMinor,
      }),
    );

    const receiptId = await ctx.db.insert('receipts', {
      number: await nextNumber(ctx, 'receipt'),
      paymentId,
      invoiceId: invoice._id,
      clientId: invoice.clientId,
      emailed: args.emailReceipt ?? true,
    });
    await ctx.db.patch('payments', paymentId, { receiptId });
    await ctx.scheduler.runAfter(0, internal.financeSending.sendReceipt, {
      receiptId,
      memberId: ctx.principal.member._id,
    });

    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'payment_event',
      title: `${formatMoney(amountMinor, invoice.currency)} received on ${invoice.number}`,
      body: whtMinor > 0 ? `With ${formatMoney(whtMinor, invoice.currency)} WHT withheld` : undefined,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId: invoice._id, paymentId },
    });
    return paymentId;
  },
});

/**
 * Records a card payment Paystack has confirmed. Keyed by its reference, so the same event twice records one payment.
 * The fee Paystack kept is stored for reporting; the client is charged the invoice amount (studio, 2026-09-23).
 */
export const recordFromPaystack = internalMutation({
  args: {
    reference: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
    feesMinor: v.optional(v.number()),
    paystackTransactionId: v.string(),
    paystackChannel: v.optional(v.string()),
    paystackInstrument: v.optional(v.string()),
    whtMinor: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    const seen = await ctx.db
      .query('payments')
      .withIndex('by_reference', (q) => q.eq('reference', args.reference))
      .unique();
    if (seen) return null;
    // inv_<invoiceId>_<attempt>
    const invoiceId = ctx.db.normalizeId('invoices', args.reference.split('_')[1] ?? '');
    if (!invoiceId) throw invoiceError('invoices.notFound', `No invoice behind ${args.reference}`);
    const invoice = await getInvoice(ctx, invoiceId);
    if (invoice.currency !== args.currency) {
      throw invoiceError('invoices.invalid', `${args.reference} is in ${args.currency}, not ${invoice.currency}`);
    }
    assertAcceptsMoney(invoice);
    const whtMinor = Math.min(Math.max(args.whtMinor, 0), Math.max(0, invoice.balanceMinor - args.amountMinor));
    if (args.amountMinor + whtMinor > invoice.balanceMinor) {
      throw invoiceError('invoices.overpaid', `${args.reference} is more than ${invoice.number} still owes`);
    }

    const paymentId = await ctx.db.insert('payments', {
      invoiceId: invoice._id,
      clientId: invoice.clientId,
      amountMinor: args.amountMinor,
      currency: invoice.currency,
      method: 'paystack',
      status: 'succeeded',
      receivedOn: await studioToday(ctx),
      reference: args.reference,
      paystackTransactionId: args.paystackTransactionId,
      paystackChannel: args.paystackChannel,
      paystackInstrument: args.paystackInstrument,
      feesMinor: args.feesMinor,
      refundedMinor: 0,
    });
    if (whtMinor > 0) {
      await ctx.db.insert('whtCredits', {
        invoiceId: invoice._id,
        clientId: invoice.clientId,
        paymentId,
        amountMinor: whtMinor,
        currency: invoice.currency,
        status: 'expected',
      });
    }
    await ctx.db.patch(
      'invoices',
      invoice._id,
      await settle(ctx, invoice, {
        paidMinor: invoice.paidMinor + args.amountMinor,
        whtCreditedMinor: invoice.whtCreditedMinor + whtMinor,
        creditedMinor: invoice.creditedMinor,
      }),
    );
    const receiptId = await ctx.db.insert('receipts', {
      number: await nextNumber(ctx, 'receipt'),
      paymentId,
      invoiceId: invoice._id,
      clientId: invoice.clientId,
      emailed: true,
    });
    await ctx.db.patch('payments', paymentId, { receiptId });
    await ctx.scheduler.runAfter(0, internal.financeSending.sendReceipt, {
      receiptId,
      memberId: invoice.createdByMemberId,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'payment_event',
      title: `${formatMoney(args.amountMinor, invoice.currency)} paid on ${invoice.number} (${args.paystackInstrument ?? 'Paystack'})`,
      body: whtMinor > 0 ? `With ${formatMoney(whtMinor, invoice.currency)} WHT withheld` : undefined,
      actor: { kind: 'system' },
      meta: { invoiceId: invoice._id, paymentId, reference: args.reference },
    });
    await notifyTeamMembers(ctx, [invoice.createdByMemberId], {
      event: 'invoice_paid',
      title: `${formatMoney(args.amountMinor, invoice.currency)} received on ${invoice.number}`,
      body: invoice.balanceMinor - args.amountMinor - whtMinor === 0 ? 'It is now settled.' : 'Part of what is owed.',
      link: `/billing/invoices/${invoice._id}`,
    });
    return null;
  },
});

/** A refund Paystack has accepted; the webhook confirms it when the money is on its way back. */
export const markRefundSent = internalMutation({
  args: { refundId: v.id('refunds'), paystackRefundId: v.string() },
  handler: async (ctx, { refundId, paystackRefundId }) => {
    await ctx.db.patch('refunds', refundId, { paystackRefundId });
  },
});

export const markRefundProcessed = internalMutation({
  args: { reference: v.string() },
  handler: async (ctx, { reference }) => {
    const payment = await ctx.db
      .query('payments')
      .withIndex('by_reference', (q) => q.eq('reference', reference))
      .unique();
    if (!payment) return;
    const refunds = await ctx.db
      .query('refunds')
      .withIndex('by_payment', (q) => q.eq('paymentId', payment._id))
      .collect();
    for (const refund of refunds.filter((row) => row.status === 'pending')) {
      await ctx.db.patch('refunds', refund._id, { status: 'processed', processedAt: Date.now() });
    }
  },
});

export const reportRefundFailed = internalMutation({
  args: { refundId: v.id('refunds'), reason: v.string() },
  handler: async (ctx, { refundId, reason }) => {
    const refund = await ctx.db.get('refunds', refundId);
    if (!refund) return;
    await ctx.db.patch('refunds', refundId, { status: 'failed' });
    await notifyTeamMembers(ctx, [refund.recordedByMemberId], {
      event: 'refund_failed',
      title: 'A card refund did not go through',
      body: `${reason.slice(0, 200)} The invoice still shows the amount as owed again.`,
    });
  },
});

export const generateUploadUrl = teamMutation('payments.record')({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Attaches proof of a payment (a bank slip or screenshot), seen only by the team. */
export const attachProof = teamMutation('payments.record')({
  args: { paymentId: v.id('payments'), storageId: v.id('_storage'), name: v.string(), contentType: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const payment = await ctx.db.get('payments', args.paymentId);
    if (!payment) throw invoiceError('invoices.notFound', 'Payment not found');
    const upload = await recordUpload(ctx, {
      storageId: args.storageId,
      name: args.name,
      contentType: args.contentType,
      context: 'document',
      owner: { table: 'payments', id: payment._id },
      visibility: 'internal',
      clientId: payment.clientId,
      uploadedBy: { kind: 'team', id: ctx.principal.member._id },
    });
    if (!upload.ok) return { ok: false, message: upload.message };
    await ctx.db.patch('payments', payment._id, { proofFileId: upload.fileId });
    return { ok: true };
  },
});

/** Gives money back from a payment. It reopens the invoice's balance by the same amount. */
export const refund = teamMutation('payments.refund')({
  args: {
    paymentId: v.id('payments'),
    amountMinor: v.number(),
    method,
    reference: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get('payments', args.paymentId);
    if (!payment) throw invoiceError('invoices.notFound', 'Payment not found');
    const amountMinor = checkedAmount(args.amountMinor, 'The refund');
    const refundable = payment.amountMinor - payment.refundedMinor;
    if (amountMinor > refundable) {
      throw invoiceError(
        'invoices.overRefund',
        `At most ${formatMoney(refundable, payment.currency)} of this payment can be refunded`,
      );
    }
    const invoice = await getInvoice(ctx, payment.invoiceId);
    if (invoice.status === 'void' || invoice.status === 'written_off') {
      throw invoiceError(
        'invoices.notOpen',
        `Refunds on a ${invoice.status.replace('_', ' ')} invoice are not recorded here`,
      );
    }
    const reason = text(args.reason, 'Reason', { required: true, max: 500 })!;
    const refundedMinor = payment.refundedMinor + amountMinor;
    await ctx.db.patch('payments', payment._id, {
      refundedMinor,
      status: refundedMinor === payment.amountMinor ? 'refunded' : 'partially_refunded',
    });
    // A card payment is refunded through Paystack, and is pending until they confirm it; anything else went back by
    // hand, so it is already done.
    const byCard = payment.method === 'paystack' && payment.reference;
    const refundId = await ctx.db.insert('refunds', {
      paymentId: payment._id,
      clientId: payment.clientId,
      amountMinor,
      currency: payment.currency,
      reason,
      method: args.method,
      reference: text(args.reference, 'Reference', { max: 120 }),
      status: byCard ? 'pending' : 'processed',
      processedAt: byCard ? undefined : Date.now(),
      recordedByMemberId: ctx.principal.member._id,
    });
    if (byCard) {
      await ctx.scheduler.runAfter(0, internal.paystack.sendRefund, {
        refundId,
        reference: payment.reference!,
        amountMinor,
      });
    }
    await ctx.db.patch(
      'invoices',
      invoice._id,
      await settle(ctx, invoice, {
        paidMinor: invoice.paidMinor - amountMinor,
        whtCreditedMinor: invoice.whtCreditedMinor,
        creditedMinor: invoice.creditedMinor,
      }),
    );
    await recordActivity(ctx, {
      subject: { table: 'clients', id: payment.clientId },
      clientId: payment.clientId,
      type: 'payment_event',
      title: `${formatMoney(amountMinor, payment.currency)} refunded on ${invoice.number}`,
      body: reason,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId: invoice._id, paymentId: payment._id },
    });
  },
});

// Withholding tax -----------------------------------------------------------------------------------------------------

async function getWhtCredit(ctx: MutationCtx, whtCreditId: Id<'whtCredits'>) {
  const credit = await ctx.db.get('whtCredits', whtCreditId);
  if (!credit) throw invoiceError('invoices.notFound', 'WHT credit not found');
  return credit;
}

function assertLive(credit: Doc<'whtCredits'>) {
  if (credit.status === 'reversed') throw invoiceError('invoices.reversed', 'This WHT credit was reversed');
}

/** The client's WHT credit note has arrived: its number, and the file if there is one. */
export const markCertificateReceived = teamMutation('payments.record')({
  args: {
    whtCreditId: v.id('whtCredits'),
    certificateNumber: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    name: v.optional(v.string()),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const credit = await getWhtCredit(ctx, args.whtCreditId);
    assertLive(credit);
    let certificateFileId: Id<'files'> | undefined;
    if (args.storageId) {
      const upload = await recordUpload(ctx, {
        storageId: args.storageId,
        name: args.name ?? 'wht-certificate',
        contentType: args.contentType ?? 'application/pdf',
        context: 'document',
        owner: { table: 'whtCredits', id: credit._id },
        visibility: 'internal',
        clientId: credit.clientId,
        uploadedBy: { kind: 'team', id: ctx.principal.member._id },
      });
      if (!upload.ok) return { ok: false, message: upload.message };
      certificateFileId = upload.fileId;
    }
    await ctx.db.patch('whtCredits', credit._id, {
      status: 'certificate_received',
      certificateNumber: text(args.certificateNumber, 'Certificate number', { max: 120 }),
      certificateFileId: certificateFileId ?? credit.certificateFileId,
      receivedAt: Date.now(),
      disputeNote: undefined,
    });
    return { ok: true };
  },
});

/** Flags a WHT credit for follow-up; the invoice stays as it is until the credit is reversed. */
export const markDisputed = teamMutation('payments.record')({
  args: { whtCreditId: v.id('whtCredits'), note: v.string() },
  handler: async (ctx, { whtCreditId, note }) => {
    const credit = await getWhtCredit(ctx, whtCreditId);
    assertLive(credit);
    await ctx.db.patch('whtCredits', credit._id, {
      status: 'disputed',
      disputeNote: text(note, 'Note', { required: true, max: 500 }),
    });
  },
});

/** Puts a WHT deduction back onto the invoice as owed, reopening it, with the reason kept (studio, 2026-09-22). */
export const reverseWht = teamMutation('payments.record')({
  args: { whtCreditId: v.id('whtCredits'), reason: v.string() },
  handler: async (ctx, { whtCreditId, reason }) => {
    const credit = await getWhtCredit(ctx, whtCreditId);
    assertLive(credit);
    const invoice = await getInvoice(ctx, credit.invoiceId);
    if (invoice.status === 'void' || invoice.status === 'written_off') {
      throw invoiceError('invoices.notOpen', `The invoice is ${invoice.status.replace('_', ' ')}`);
    }
    const why = text(reason, 'Reason', { required: true, max: 500 })!;
    await ctx.db.patch('whtCredits', credit._id, { status: 'reversed', reversedReason: why, reversedAt: Date.now() });
    await ctx.db.patch(
      'invoices',
      invoice._id,
      await settle(ctx, invoice, {
        paidMinor: invoice.paidMinor,
        whtCreditedMinor: invoice.whtCreditedMinor - credit.amountMinor,
        creditedMinor: invoice.creditedMinor,
      }),
    );
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'payment_event',
      title: `WHT of ${formatMoney(credit.amountMinor, credit.currency)} reversed on ${invoice.number}`,
      body: why,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId: invoice._id, whtCreditId: credit._id },
    });
  },
});

/** WHT credits still waiting for their certificate, oldest first: they offset the studio's own tax. */
export const whtOutstanding = teamQuery('invoices.view')({
  args: {},
  handler: async (ctx) => {
    const rows = [
      ...(await ctx.db
        .query('whtCredits')
        .withIndex('by_status', (q) => q.eq('status', 'expected'))
        .collect()),
      ...(await ctx.db
        .query('whtCredits')
        .withIndex('by_status', (q) => q.eq('status', 'disputed'))
        .collect()),
    ];
    const views = await Promise.all(
      rows.map(async (row) => {
        const [client, invoice] = await Promise.all([
          ctx.db.get('clients', row.clientId),
          ctx.db.get('invoices', row.invoiceId),
        ]);
        return {
          id: row._id,
          clientName: client?.displayName ?? 'Unknown client',
          invoiceId: row.invoiceId,
          invoiceNumber: invoice?.number,
          amountMinor: row.amountMinor,
          currency: row.currency,
          status: row.status,
          since: row._creationTime,
        };
      }),
    );
    return views.sort((a, b) => a.since - b.since);
  },
});
