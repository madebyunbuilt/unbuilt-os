import { ConvexError } from 'convex/values';
import { type Doc } from '../_generated/dataModel';
import { applyBps } from './money';

// Vendors and bills (08-billing-and-finance.md, Vendors and bills). The other side of the withholding tax the studio
// already handles on its own invoices: here the studio is the one deducting, so it pays the vendor less and owes the
// difference to the tax authority.

export function billError(code: `bills.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** Bills due within this many days are worth telling the people who pay about. */
export const DUE_SOON_DAYS = 7;

export const EDITABLE: ReadonlySet<Doc<'bills'>['status']> = new Set(['draft', 'approved', 'scheduled']);
export const PAYABLE: ReadonlySet<Doc<'bills'>['status']> = new Set(['approved', 'scheduled']);

/**
 * What the studio withholds on a bill and what the vendor is actually paid. Withholding is worked out on the amount
 * before the VAT the vendor charged, the same way it is on the studio's own invoices: VAT is the tax authority's
 * money already and is never withheld against.
 */
export function billSplit(
  bill: { amountMinor: number; vatMinor?: number },
  whtBps: number | undefined,
): { netMinor: number; whtMinor: number; payableMinor: number } {
  const vatMinor = bill.vatMinor ?? 0;
  const netMinor = bill.amountMinor - vatMinor;
  const whtMinor = whtBps && whtBps > 0 ? applyBps(netMinor, whtBps) : 0;
  return { netMinor, whtMinor, payableMinor: bill.amountMinor - whtMinor };
}

export function assertBillAmounts(bill: { amountMinor: number; vatMinor?: number }) {
  if (!Number.isSafeInteger(bill.amountMinor) || bill.amountMinor <= 0) {
    throw billError('bills.invalid', 'A bill needs a whole amount above zero');
  }
  const vatMinor = bill.vatMinor ?? 0;
  if (!Number.isSafeInteger(vatMinor) || vatMinor < 0) {
    throw billError('bills.invalid', 'VAT must be a whole amount or nothing');
  }
  if (vatMinor > bill.amountMinor) {
    throw billError('bills.invalid', 'The VAT on a bill cannot be more than the bill');
  }
}

export function assertEditable(bill: Doc<'bills'>) {
  if (!EDITABLE.has(bill.status)) {
    throw billError('bills.closed', `A ${bill.status} bill no longer changes`);
  }
}

export function assertPayable(bill: Doc<'bills'>) {
  if (bill.status === 'paid') throw billError('bills.paid', 'This bill has already been paid');
  if (!PAYABLE.has(bill.status)) {
    throw billError(
      'bills.notApproved',
      bill.status === 'void' ? 'This bill was voided' : 'Approve the bill before paying it',
    );
  }
}
