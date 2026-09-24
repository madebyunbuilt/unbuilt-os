import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { portalQuery } from './lib/functions';
import { invoiceError, OPEN_STATUSES, TYPE_LABELS } from './lib/invoices';
import { whtExpectedOnBalance } from './lib/money';
import { type ClientPrincipal } from './lib/principals';
import { getOrgSettings } from './lib/settings';
import { buildStatement, checkedRange } from './lib/statements';
import { paystackTakes } from './lib/paystack';
import { portalAppOrigin } from './lib/hosts';
import { deriveToken } from './lib/payLinks';
import { sha256Hex } from './lib/signatures';

// Invoices in the client portal (12-client-portal.md, Invoices). The client reads what they owe and what they have
// paid, and pays with the same Paystack flow the token page uses. Nothing about the studio's own costs is here; an
// invoice written off is not shown at all, because a client is never told their debt was abandoned.

/** A draft is not the client's business, and a written-off invoice is never shown to them (08-billing-and-finance.md). */
const VISIBLE: ReadonlySet<Doc<'invoices'>['status']> = new Set([
  'sent',
  'viewed',
  'partially_paid',
  'paid',
  'overdue',
]);

async function clientInvoice(ctx: QueryCtx | MutationCtx, invoiceId: Id<'invoices'>, clientId: Id<'clients'>) {
  const invoice = await ctx.db.get('invoices', invoiceId);
  if (!invoice || invoice.clientId !== clientId || !VISIBLE.has(invoice.status)) return null;
  return invoice;
}

function invoiceView(invoice: Doc<'invoices'>) {
  return {
    id: invoice._id,
    number: invoice.number ?? '',
    typeLabel: TYPE_LABELS[invoice.type],
    status: invoice.status,
    currency: invoice.currency,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    totalMinor: invoice.totals.totalMinor,
    balanceMinor: invoice.balanceMinor,
    paidMinor: invoice.paidMinor,
    // What they have been credited, which is their business; what the studio wrote off is not.
    creditedMinor: invoice.creditedMinor,
    whtCreditedMinor: invoice.whtCreditedMinor,
    pdfFileId: invoice.pdfFileId,
    payable: OPEN_STATUSES.has(invoice.status) && invoice.balanceMinor > 0,
  };
}

export const invoices = portalQuery('portal.invoices.view')({
  args: {},
  handler: async (ctx) => {
    const principal = ctx.principal as ClientPrincipal;
    const rows = await ctx.db
      .query('invoices')
      .withIndex('by_client_status', (q) => q.eq('clientId', principal.clientId))
      .collect();
    return rows
      .filter((invoice) => VISIBLE.has(invoice.status))
      .map(invoiceView)
      .sort((a, b) => (b.issueDate ?? '').localeCompare(a.issueDate ?? ''));
  },
});

/** One invoice, with what has been paid against it and the receipts and credit notes to download. */
export const invoice = portalQuery('portal.invoices.view')({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, { invoiceId }) => {
    const principal = ctx.principal as ClientPrincipal;
    const found = await clientInvoice(ctx, invoiceId, principal.clientId);
    if (!found) return null;

    const [payments, receipts, creditNotes, settings] = await Promise.all([
      ctx.db
        .query('payments')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect(),
      ctx.db
        .query('receipts')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect(),
      ctx.db
        .query('creditNotes')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect(),
      getOrgSettings(ctx),
    ]);

    return {
      ...invoiceView(found),
      lineItems: found.lineItems,
      totals: found.totals,
      vat: found.vat,
      // Only where this client withholds: the figure is theirs to act on, and meaningless otherwise.
      whtOnBalanceMinor: found.wht.applies ? whtExpectedOnBalance(found.totals, found.balanceMinor) : 0,
      payments: payments
        .filter((payment) => payment.status === 'succeeded')
        .map((payment) => ({
          id: payment._id,
          amountMinor: payment.amountMinor,
          receivedOn: payment.receivedOn,
          // What the client would recognise: how they paid, and Paystack's own reference where there is one.
          method: payment.paystackInstrument ?? payment.method,
          reference: payment.paystackTransactionId ?? payment.reference,
          receiptId: receipts.find((receipt) => receipt.paymentId === payment._id)?._id,
          receiptNumber: receipts.find((receipt) => receipt.paymentId === payment._id)?.number,
          receiptFileId: receipts.find((receipt) => receipt.paymentId === payment._id)?.pdfFileId,
        }))
        .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn)),
      creditNotes: creditNotes.map((note) => ({
        id: note._id,
        number: note.number,
        amountMinor: note.amountMinor,
        issuedOn: note.issueDate,
        pdfFileId: note.pdfFileId,
      })),
      // What the studio can take by card, so the page offers what will actually work.
      byCard: paystackTakes(found.currency),
      bankAccounts: settings.bankAccounts
        .filter((account) => account.currency === found.currency)
        .map(({ bankName, accountName, accountNumber, swift, iban }) => ({
          bankName,
          accountName,
          accountNumber,
          swift,
          iban,
        })),
    };
  },
});

/** The client's own statement of account for a range, built by the same code the studio's copy uses. */
export const statement = portalQuery('portal.invoices.view')({
  args: { fromDate: v.string(), toDate: v.string() },
  handler: async (ctx, { fromDate, toDate }) => {
    const principal = ctx.principal as ClientPrincipal;
    checkedRange(fromDate, toDate);
    return await buildStatement(ctx, principal.clientId, fromDate, toDate);
  },
});

/**
 * Where a signed-in client pays their own invoice. The token is derived from the invoice rather than drawn at random
 * (08-billing-and-finance.md), so this works it out the same way an email does and hands back the same page — one pay
 * page, whether they arrived from their inbox or from here.
 *
 * An invoice sent before that rule still holds the hash of its old random token, and only a send can replace it, so
 * this offers no link rather than one that would not open.
 */
export const payLink = portalQuery('portal.invoices.pay')({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, { invoiceId }) => {
    const principal = ctx.principal as ClientPrincipal;
    const found = await clientInvoice(ctx, invoiceId, principal.clientId);
    if (!found) throw invoiceError('invoices.notFound', 'That invoice is not available');
    const origin = portalAppOrigin();
    if (!origin || !process.env.PAY_LINK_SECRET || !found.payToken) return { url: null };
    const token = await deriveToken(found._id);
    // The stored hash is what the pay page looks up; if it was minted before the rule changed, they differ.
    return { url: (await sha256Hex(token)) === found.payToken ? `${origin}/pay/${token}` : null };
  },
});
