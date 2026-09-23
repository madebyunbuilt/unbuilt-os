import { ConvexError, v } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { localDateString } from './businessTime';
import { text } from './crm';
import {
  calculateTotals,
  type Currency,
  type Discount,
  invoiceBalance,
  type LineInput,
  MICRO_PER_UNIT,
  type TaxSetting,
} from './money';
import { getOrgSettings } from './settings';
import { isIsoDate } from './validation';

// Invoice rules shared by the invoice functions and the sending action (08-billing-and-finance.md, Invoices). Totals
// only ever come from convex/lib/money.ts.

export function invoiceError(code: `invoices.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** When neither the client nor the studio names payment terms (decided by the studio, 2026-09-22). */
export const DEFAULT_PAYMENT_TERMS_DAYS = 14;

/** A USD or EUR invoice is sent only with a rate entered in the last week (08-billing-and-finance.md, Foreign exchange). */
export const FX_RATE_MAX_AGE_DAYS = 7;

export const INVOICE_TYPES = [
  'standard',
  'deposit',
  'milestone',
  'retainer',
  'time_and_materials',
  'renewal',
  'late_fee',
  'change_request',
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const TYPE_LABELS: Record<InvoiceType, string> = {
  standard: 'Invoice',
  deposit: 'Deposit invoice',
  milestone: 'Milestone invoice',
  retainer: 'Retainer invoice',
  time_and_materials: 'Time and materials invoice',
  renewal: 'Renewal invoice',
  late_fee: 'Late fee invoice',
  change_request: 'Change request invoice',
};

export const lineItemValidator = v.object({
  description: v.string(),
  quantityMilli: v.number(),
  unitPriceMinor: v.number(),
  rateCardItemId: v.optional(v.id('rateCardItems')),
  taxable: v.optional(v.boolean()),
});

export const discountValidator = v.object({
  kind: v.union(v.literal('none'), v.literal('percent'), v.literal('fixed')),
  bps: v.optional(v.number()),
  amountMinor: v.optional(v.number()),
});

export type InvoiceLine = Doc<'invoices'>['lineItems'][number];

/** Checks each line a person entered, before the totals are worked out. */
export function checkedLines(items: (typeof lineItemValidator.type)[]): InvoiceLine[] {
  if (items.length > 200) throw invoiceError('invoices.invalid', 'An invoice can have at most 200 lines');
  return items.map((item) => {
    if (!Number.isSafeInteger(item.quantityMilli) || item.quantityMilli <= 0) {
      throw invoiceError('invoices.invalid', 'Each line needs a quantity above zero');
    }
    if (!Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) {
      throw invoiceError('invoices.invalid', 'Each line needs a whole, non-negative price');
    }
    return {
      description: text(item.description, 'Line description', { required: true, max: 500 })!,
      quantityMilli: item.quantityMilli,
      unitPriceMinor: item.unitPriceMinor,
      amountMinor: 0,
      rateCardItemId: item.rateCardItemId,
      taxable: item.taxable ?? true,
    };
  });
}

export function checkedDiscount(discount: typeof discountValidator.type | undefined): Discount {
  if (!discount || discount.kind === 'none') return { kind: 'none' };
  if (discount.kind === 'percent') {
    if (discount.bps === undefined) throw invoiceError('invoices.invalid', 'A percentage discount needs a percentage');
    return { kind: 'percent', bps: discount.bps };
  }
  if (discount.amountMinor === undefined) throw invoiceError('invoices.invalid', 'A fixed discount needs an amount');
  return { kind: 'fixed', amountMinor: discount.amountMinor };
}

export function checkedTax(tax: TaxSetting, label: string): TaxSetting {
  if (!Number.isInteger(tax.bps) || tax.bps < 0 || tax.bps > 10_000) {
    throw invoiceError('invoices.invalid', `${label} must be between 0% and 100%`);
  }
  return tax;
}

/** Lines with their amounts, and the totals, from the one money library. */
export function invoiceTotals(lines: InvoiceLine[], discount: Discount, vat: TaxSetting, wht: TaxSetting) {
  const input: LineInput[] = lines.map((line) => ({
    quantityMilli: line.quantityMilli,
    unitPriceMinor: line.unitPriceMinor,
    taxable: line.taxable,
  }));
  const { lineAmountsMinor, totals } = calculateTotals({ lines: input, discount, vat, wht });
  return { lineItems: lines.map((line, index) => ({ ...line, amountMinor: lineAmountsMinor[index] })), totals };
}

/** VAT follows the client's treatment at the studio's rate; WHT is the client's own rate. */
export async function taxDefaultsFor(ctx: QueryCtx | MutationCtx, client: Doc<'clients'>) {
  const settings = await getOrgSettings(ctx);
  return {
    vat: { applies: client.vatTreatment === 'standard', bps: settings.defaultVatBps },
    wht: { applies: client.whtApplies === true, bps: client.whtBps ?? 0 },
  };
}

/** The client's terms, else the studio's, else 14 days. */
export async function paymentTermsFor(ctx: QueryCtx | MutationCtx, client: Doc<'clients'>): Promise<number> {
  return client.paymentTermsDays ?? (await getOrgSettings(ctx)).defaultPaymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
}

export function checkedTerms(days: number): number {
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw invoiceError('invoices.invalid', 'Payment terms are between 0 and 365 days');
  }
  return days;
}

export function checkedDate(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isIsoDate(value)) throw invoiceError('invoices.invalid', `${label} must be a date`);
  return value;
}

export async function studioToday(ctx: QueryCtx | MutationCtx): Promise<string> {
  return localDateString(Date.now(), (await getOrgSettings(ctx)).timezone);
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The most recent rate for a currency, on or before a date. NGN is always one to one. */
export async function latestFxRate(ctx: QueryCtx | MutationCtx, currency: Currency, onOrBefore?: string) {
  if (currency === 'NGN') return { rateToNgnMicro: MICRO_PER_UNIT, date: undefined };
  const row = await ctx.db
    .query('fxRates')
    .withIndex('by_currency_date', (q) =>
      onOrBefore ? q.eq('currency', currency).lte('date', onOrBefore) : q.eq('currency', currency),
    )
    .order('desc')
    .first();
  return row ? { rateToNgnMicro: row.rateToNgnMicro, date: row.date } : null;
}

/** Statuses where the invoice is out with the client and money can still be owed on it. */
export const OPEN_STATUSES: ReadonlySet<Doc<'invoices'>['status']> = new Set([
  'sent',
  'viewed',
  'partially_paid',
  'overdue',
]);

export async function getInvoice(ctx: QueryCtx | MutationCtx, invoiceId: Id<'invoices'>) {
  const invoice = await ctx.db.get('invoices', invoiceId);
  if (!invoice) throw invoiceError('invoices.notFound', 'Invoice not found');
  return invoice;
}

/** Who an invoice goes to: the contacts chosen, or the billing contacts, or the primary contact if none is marked. */
export async function invoiceRecipients(
  ctx: MutationCtx | QueryCtx,
  clientId: Id<'clients'>,
  contactIds?: Id<'contacts'>[],
) {
  const contacts = await ctx.db
    .query('contacts')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  const active = contacts.filter((contact) => contact.status === 'active');
  if (contactIds?.length) {
    const chosen = active.filter((contact) => contactIds.includes(contact._id));
    if (chosen.length !== new Set(contactIds).size) {
      throw invoiceError('invoices.invalid', 'Choose active contacts at this client');
    }
    return chosen.map((contact) => ({ id: contact._id, name: contact.name, email: contact.email }));
  }
  const billing = active.filter((contact) => contact.isBilling);
  const chosen = billing.length > 0 ? billing : active.filter((contact) => contact.isPrimary).slice(0, 1);
  return chosen.map((contact) => ({ id: contact._id, name: contact.name, email: contact.email }));
}

export type InvoiceRecipient = Awaited<ReturnType<typeof invoiceRecipients>>[number];

type Settlement = Pick<Doc<'invoices'>, 'paidMinor' | 'whtCreditedMinor' | 'creditedMinor'>;

/**
 * The balance and status after money moves on an invoice, from the money library's settlement rule: paid + WHT
 * credited + credits = total means paid. Otherwise past due is overdue, part settled is partly paid, and the rest is
 * opened or sent. Throws if the money would exceed the total.
 */
export async function settle(ctx: QueryCtx | MutationCtx, invoice: Doc<'invoices'>, next: Settlement) {
  const { balanceMinor, settled, partiallySettled } = invoiceBalance({
    totalMinor: invoice.totals.totalMinor,
    ...next,
  });
  const today = await studioToday(ctx);
  // Past due with money still owed is overdue, even when part was paid (studio, 2026-09-22). Credits alone correct the
  // invoice rather than pay it, so they never make it "partly paid".
  const moneyIn = next.paidMinor + next.whtCreditedMinor > 0;
  const status: Doc<'invoices'>['status'] = settled
    ? 'paid'
    : invoice.dueDate && invoice.dueDate < today
      ? 'overdue'
      : partiallySettled && moneyIn
        ? 'partially_paid'
        : invoice.firstViewedAt
          ? 'viewed'
          : 'sent';
  return {
    ...next,
    balanceMinor,
    status,
    paidAt: settled ? (invoice.paidAt ?? Date.now()) : undefined,
  };
}

/** Invoices money can still be recorded against: out with the client and not yet settled, voided or written off. */
export function assertAcceptsMoney(invoice: Doc<'invoices'>) {
  if (invoice.status === 'written_off') {
    throw invoiceError('invoices.writtenOff', 'This invoice was written off. Reverse the write-off first.');
  }
  if (!OPEN_STATUSES.has(invoice.status)) {
    throw invoiceError('invoices.notOpen', `A ${invoice.status.replace('_', ' ')} invoice takes no more money`);
  }
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * Which reminder is due today, if any (08-billing-and-finance.md, Reminders): 3 days before the due date, on it, 3, 7
 * and 14 days after, then every 7 days. Each is sent once. If the daily run missed a day, only the latest reminder that
 * has come due is sent, so a client never gets "due in 3 days" once it is already late.
 */
export function reminderDue(dueDate: string, today: string, sentKinds: readonly string[]): string | null {
  const late = dayNumber(today) - dayNumber(dueDate);
  let kind: string | null = null;
  if (late >= -3) kind = 'before_3';
  if (late >= 0) kind = 'due';
  if (late >= 3) kind = 'after_3';
  if (late >= 7) kind = 'after_7';
  if (late >= 14) kind = 'after_14';
  if (late >= 21) kind = `weekly_${Math.floor((late - 14) / 7)}`;
  return kind && !sentKinds.includes(kind) ? kind : null;
}

/** How a reminder describes itself to the client. */
export function reminderWording(kind: string): 'soon' | 'today' | 'late' {
  if (kind === 'before_3') return 'soon';
  if (kind === 'due') return 'today';
  return 'late';
}
