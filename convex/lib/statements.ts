import { type Id } from '../_generated/dataModel';
import { type QueryCtx } from '../_generated/server';
import { localDateString } from './businessTime';
import { type Currency, runningBalances } from './money';
import { getOrgSettings } from './settings';

// A client's statement of account (08-billing-and-finance.md, Statements): for a date range, per currency, the
// opening balance, each invoice, payment, WHT credit, credit note and refund, and the closing balance. Write-offs are
// never shown to the client (studio, 2026-09-22); so the lines still add up, a written-off invoice is left off
// entirely, with everything recorded against it. Void invoices never count. Held credit applied to a later invoice is
// not a line of its own: the credit note that created it already reduced the balance.

export type StatementLine = {
  date: string;
  kind: 'invoice' | 'payment' | 'wht' | 'credit_note' | 'refund';
  description: string;
  /** What it adds to what the client owes. */
  debitMinor: number;
  /** What it takes off. */
  creditMinor: number;
};

export type StatementSection = {
  currency: Currency;
  openingMinor: number;
  lines: (StatementLine & { balanceMinor: number })[];
  closingMinor: number;
};

/** "2026-10-31" as "31 Oct 2026". */
const shortDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    Date.parse(`${value}T00:00:00Z`),
  );

/** Every line on a client's account, in every currency, from the start. */
async function allLines(ctx: QueryCtx, clientId: Id<'clients'>) {
  const timezone = (await getOrgSettings(ctx)).timezone;
  const day = (instant: number) => localDateString(instant, timezone);
  const invoices = (
    await ctx.db
      .query('invoices')
      .withIndex('by_client_status', (q) => q.eq('clientId', clientId))
      .collect()
  ).filter((invoice) => invoice.issueDate && invoice.status !== 'void' && invoice.status !== 'written_off');
  const shown = new Map(invoices.map((invoice) => [invoice._id, invoice]));

  const lines: (StatementLine & { currency: Currency })[] = invoices.map((invoice) => ({
    currency: invoice.currency,
    date: invoice.issueDate!,
    kind: 'invoice',
    description: `Invoice ${invoice.number}${invoice.dueDate ? `, due ${shortDate(invoice.dueDate)}` : ''}`,
    debitMinor: invoice.totals.totalMinor,
    creditMinor: 0,
  }));

  const payments = await ctx.db
    .query('payments')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  for (const payment of payments) {
    const invoice = shown.get(payment.invoiceId);
    if (!invoice || payment.status === 'failed' || payment.status === 'pending') continue;
    lines.push({
      currency: payment.currency,
      date: payment.receivedOn,
      kind: 'payment',
      description: `Payment for ${invoice.number}${payment.reference ? `, ref ${payment.reference}` : ''}`,
      debitMinor: 0,
      creditMinor: payment.amountMinor,
    });
  }

  const wht = await ctx.db
    .query('whtCredits')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  for (const credit of wht) {
    const invoice = shown.get(credit.invoiceId);
    if (!invoice || credit.status === 'reversed') continue;
    const payment = credit.paymentId ? payments.find((row) => row._id === credit.paymentId) : undefined;
    lines.push({
      currency: credit.currency,
      date: payment?.receivedOn ?? day(credit._creationTime),
      kind: 'wht',
      description: `Withholding tax on ${invoice.number}`,
      debitMinor: 0,
      creditMinor: credit.amountMinor,
    });
  }

  const notes = await ctx.db
    .query('creditNotes')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  for (const note of notes) {
    const invoice = shown.get(note.invoiceId);
    if (!invoice) continue;
    lines.push({
      currency: note.currency,
      date: note.issueDate,
      kind: 'credit_note',
      description: `Credit note ${note.number} against ${invoice.number}`,
      debitMinor: 0,
      creditMinor: note.amountMinor,
    });
  }

  const refunds = await ctx.db
    .query('refunds')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  for (const refund of refunds) {
    if (refund.status !== 'processed') continue;
    if (refund.paymentId) {
      const payment = payments.find((row) => row._id === refund.paymentId);
      if (!payment || !shown.has(payment.invoiceId)) continue;
    }
    lines.push({
      currency: refund.currency,
      date: day(refund.processedAt ?? refund._creationTime),
      kind: 'refund',
      description: refund.clientCreditId ? 'Refund of credit held' : 'Refund of a payment',
      debitMinor: refund.amountMinor,
      creditMinor: 0,
    });
  }
  return lines;
}

const ORDER: Record<StatementLine['kind'], number> = { invoice: 0, credit_note: 1, payment: 2, wht: 3, refund: 4 };

/** The statement for a date range, one section per currency the client has used. */
export async function buildStatement(
  ctx: QueryCtx,
  clientId: Id<'clients'>,
  fromDate: string,
  toDate: string,
): Promise<StatementSection[]> {
  const lines = await allLines(ctx, clientId);
  const currencies = [...new Set(lines.map((line) => line.currency))].sort();
  return currencies.map((currency) => {
    const mine = lines.filter((line) => line.currency === currency);
    const before = runningBalances(
      0,
      mine.filter((line) => line.date < fromDate),
    );
    const openingMinor = before.closingMinor;
    const within = mine
      .filter((line) => line.date >= fromDate && line.date <= toDate)
      .sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind]);
    const { balances, closingMinor } = runningBalances(openingMinor, within);
    const inRange = within.map(({ currency: _currency, ...line }, index) => ({
      ...line,
      balanceMinor: balances[index],
    }));
    return { currency, openingMinor, lines: inRange, closingMinor };
  });
}
