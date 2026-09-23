import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { consumeRateLimit } from './lib/enquiries';
import { internalAction, internalMutation, internalQuery } from './lib/functions';
import { portalAppOrigin } from './lib/hosts';
import { invoiceError } from './lib/invoices';
import { formatMoney } from './lib/money';
import {
  initialiseTransaction,
  paymentReference,
  paystackTakes,
  refundTransaction,
  verifyTransaction,
} from './lib/paystack';
import { sha256Hex } from './lib/signatures';

// Card payments through Paystack (08-billing-and-finance.md, Paystack). The transaction is created when the client
// presses Pay, for exactly what is owed then, so a link never charges a stale amount. Nothing is recorded as paid from
// the browser: the redirect only shows a message, and the money is recorded when Paystack's webhook is verified and the
// transaction confirmed with Paystack itself.

/** The invoice behind a pay token, with what a checkout needs. */
export const checkoutData = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const tokenHash = await sha256Hex(token);
    const invoice = await ctx.db
      .query('invoices')
      .withIndex('by_pay_token', (q) => q.eq('payToken', tokenHash))
      .unique();
    if (!invoice) throw invoiceError('invoices.notFound', 'This payment link is not valid');
    const contacts = await ctx.db
      .query('contacts')
      .withIndex('by_client', (q) => q.eq('clientId', invoice.clientId))
      .collect();
    const active = contacts.filter((contact) => contact.status === 'active');
    const billing = active.filter((contact) => contact.isBilling);
    const email = (billing[0] ?? active[0])?.email;
    return {
      invoiceId: invoice._id,
      number: invoice.number ?? '',
      currency: invoice.currency,
      balanceMinor: invoice.balanceMinor,
      whtMinor: invoice.wht.applies ? invoice.totals.whtExpectedMinor : 0,
      totalMinor: invoice.totals.totalMinor,
      status: invoice.status,
      email,
      attempts: (invoice.paystack?.reference?.split('_').at(-1) ?? '0') as string,
    };
  },
});

export const rememberTransaction = internalMutation({
  args: {
    invoiceId: v.id('invoices'),
    reference: v.string(),
    accessCode: v.string(),
    authorizationUrl: v.string(),
  },
  handler: async (ctx, { invoiceId, ...paystack }) => {
    await ctx.db.patch('invoices', invoiceId, {
      paystack: { ...paystack, linkExpiresAt: Date.now() + 60 * 60 * 1000 },
    });
  },
});

export const limitCheckouts = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) =>
    await consumeRateLimit(ctx.db, key, { max: 20, windowMs: 60 * 60 * 1000 }, Date.now()),
});

/**
 * Starts a checkout for what is owed now, or for what is owed less the withholding tax the client keeps back. Returns
 * the Paystack page to open.
 */
export const startCheckout = internalAction({
  args: { token: v.string(), withholdWht: v.boolean(), ip: v.string() },
  handler: async (ctx, { token, withholdWht, ip }): Promise<{ authorizationUrl: string; amountMinor: number }> => {
    const invoice = await ctx.runQuery(internal.paystack.checkoutData, { token });
    if (!(await ctx.runMutation(internal.paystack.limitCheckouts, { key: `pay:${ip}` }))) {
      throw invoiceError('invoices.rateLimited', 'Too many attempts. Try again in a little while.');
    }
    if (invoice.balanceMinor <= 0 || !['sent', 'viewed', 'partially_paid', 'overdue'].includes(invoice.status)) {
      throw invoiceError('invoices.notOpen', 'This invoice is not open for payment');
    }
    if (!paystackTakes(invoice.currency)) {
      throw invoiceError('invoices.noCard', `${invoice.currency} invoices are paid by bank transfer`);
    }
    if (!invoice.email) throw invoiceError('invoices.noRecipients', 'This client has no contact to receipt');

    // The withheld part is paid to the tax office by the client, never to the studio.
    const whtMinor = withholdWht ? Math.min(invoice.whtMinor, invoice.balanceMinor) : 0;
    const amountMinor = invoice.balanceMinor - whtMinor;
    if (amountMinor <= 0) throw invoiceError('invoices.invalid', 'There is nothing to pay by card');

    const attempt = Number(invoice.attempts) + 1;
    const reference = paymentReference(invoice.invoiceId, Number.isFinite(attempt) ? attempt : 1);
    const transaction = await initialiseTransaction({
      email: invoice.email,
      amountMinor,
      currency: invoice.currency,
      reference,
      callbackUrl: `${portalAppOrigin() ?? ''}/pay/${token}/done`,
      metadata: { invoiceId: invoice.invoiceId, whtMinor, invoiceNumber: invoice.number },
    });
    await ctx.runMutation(internal.paystack.rememberTransaction, {
      invoiceId: invoice.invoiceId as Id<'invoices'>,
      reference: transaction.reference,
      accessCode: transaction.access_code,
      authorizationUrl: transaction.authorization_url,
    });
    return { authorizationUrl: transaction.authorization_url, amountMinor };
  },
});

// Webhook processing ----------------------------------------------------------------------------------------------

/** Stores an event once. Returns false when it has been seen before, so it is processed exactly once. */
export const recordEvent = internalMutation({
  args: { eventId: v.string(), type: v.string(), payload: v.string() },
  handler: async (ctx, { eventId, type, payload }) => {
    const existing = await ctx.db
      .query('webhookEvents')
      .withIndex('by_provider_event', (q) => q.eq('provider', 'paystack').eq('eventId', eventId))
      .unique();
    if (existing) return null;
    return await ctx.db.insert('webhookEvents', {
      provider: 'paystack',
      eventId,
      type,
      receivedAt: Date.now(),
      status: 'received',
      attempts: 0,
      payload,
    });
  },
});

export const finishEvent = internalMutation({
  args: {
    eventId: v.id('webhookEvents'),
    status: v.union(v.literal('processed'), v.literal('failed'), v.literal('ignored')),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, status, error }) => {
    const event = await ctx.db.get('webhookEvents', eventId);
    if (!event) return;
    await ctx.db.patch('webhookEvents', eventId, {
      status,
      processedAt: Date.now(),
      error: error?.slice(0, 500),
      attempts: event.attempts + 1,
    });
  },
});

/**
 * Handles one Paystack event. A successful charge is confirmed with Paystack before any money is recorded, and the
 * payment is keyed by its reference, so the same event twice records one payment.
 */
export const processEvent = internalAction({
  args: { eventId: v.id('webhookEvents'), type: v.string(), payload: v.string() },
  handler: async (ctx, { eventId, type, payload }): Promise<null> => {
    try {
      const event = JSON.parse(payload) as { data?: { reference?: string; status?: string } };
      const reference = event.data?.reference;
      if (type === 'charge.success' && reference) {
        // Paystack itself, not the webhook body, decides what was paid.
        const verified = await verifyTransaction(reference);
        if (verified.status !== 'success') throw new Error(`Paystack says the charge is ${verified.status}`);
        const whtMinor = Number(verified.metadata?.whtMinor ?? 0);
        await ctx.runMutation(internal.payments.recordFromPaystack, {
          reference: verified.reference,
          amountMinor: verified.amount,
          currency: verified.currency,
          feesMinor: verified.fees,
          paystackTransactionId: String(verified.id),
          whtMinor: Number.isFinite(whtMinor) ? whtMinor : 0,
        });
      } else if (type === 'refund.processed' && reference) {
        await ctx.runMutation(internal.payments.markRefundProcessed, { reference });
      } else {
        await ctx.runMutation(internal.paystack.finishEvent, { eventId, status: 'ignored' });
        return null;
      }
      await ctx.runMutation(internal.paystack.finishEvent, { eventId, status: 'processed' });
      return null;
    } catch (error) {
      await ctx.runMutation(internal.paystack.finishEvent, {
        eventId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'The event could not be processed',
      });
      throw error;
    }
  },
});

/** Asks Paystack to refund a card payment; the webhook records it when Paystack has done it. */
export const sendRefund = internalAction({
  args: { refundId: v.id('refunds'), reference: v.string(), amountMinor: v.number() },
  handler: async (ctx, { refundId, reference, amountMinor }): Promise<null> => {
    try {
      const refund = await refundTransaction({ reference, amountMinor });
      await ctx.runMutation(internal.payments.markRefundSent, { refundId, paystackRefundId: String(refund.id) });
    } catch (error) {
      await ctx.runMutation(internal.payments.reportRefundFailed, {
        refundId,
        reason: error instanceof Error ? error.message : 'Paystack refused the refund',
      });
      throw error;
    }
    return null;
  },
});

export const summarise = (amountMinor: number, currency: string) =>
  formatMoney(amountMinor, currency as 'NGN' | 'USD' | 'EUR');
