import { type StatusTone } from '@/lib/team-display';

// How invoices are shown (08-billing-and-finance.md, Lifecycle), in the words the studio would use.

export type InvoiceStatus =
  'draft' | 'scheduled' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off';

export const INVOICE_STATUSES: InvoiceStatus[] = [
  'draft',
  'sent',
  'viewed',
  'partially_paid',
  'overdue',
  'paid',
  'void',
  'written_off',
];

/**
 * The status in words. Pass what was paid and withheld, so an invoice settled only by credit notes reads "Credited in
 * full" rather than "Paid".
 */
export function invoiceStatus(
  status: InvoiceStatus,
  money?: { paidMinor: number; whtCreditedMinor: number },
): { label: string; tone: StatusTone } {
  if (status === 'paid' && money && money.paidMinor + money.whtCreditedMinor === 0) {
    return { label: 'Credited in full', tone: 'built' };
  }
  switch (status) {
    case 'draft':
      return { label: 'Draft', tone: 'draft' };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'draft' };
    case 'sent':
      return { label: 'Sent', tone: 'draft' };
    case 'viewed':
      return { label: 'Opened', tone: 'draft' };
    case 'partially_paid':
      return { label: 'Partly paid', tone: 'draft' };
    case 'paid':
      return { label: 'Paid', tone: 'built' };
    case 'overdue':
      return { label: 'Overdue', tone: 'attention' };
    case 'void':
      return { label: 'Void', tone: 'muted' };
    case 'written_off':
      return { label: 'Written off', tone: 'muted' };
  }
}

/** Statuses money can still be recorded against. */
export const OPEN_INVOICE_STATUSES: ReadonlySet<InvoiceStatus> = new Set([
  'sent',
  'viewed',
  'partially_paid',
  'overdue',
]);

export const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];

/** How a payment arrived. A Paystack payment says what the client actually used, e.g. "Card · visa ending 4081". */
export const methodLabel = (method: string, instrument?: string) =>
  method === 'paystack'
    ? (instrument ?? 'Paystack')
    : (PAYMENT_METHODS.find((option) => option.value === method)?.label ?? method);

/** Today in the studio's calendar, for date inputs. Lagos is always UTC+1, with no daylight saving. */
export function lagosToday(now: number = Date.now()): string {
  return new Date(now + 60 * 60 * 1000).toISOString().slice(0, 10);
}
