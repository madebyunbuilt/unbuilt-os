import { ConvexError } from 'convex/values';

// Retainer rules (08-billing-and-finance.md, Retainers). A retainer is billed a period **in advance**: on the invoice
// day the period that has just ended is closed and the coming one is invoiced. Overage can only be billed after the
// fact, so the closed period's overage goes out on the same day, in arrears.
//
// Rollover carries unused minutes into the next period **only**, and they expire after it (studio, 2026-09-23). To make
// that worth having, minutes used are taken from the rollover first: otherwise carried minutes would nearly always
// expire unused while the period's own minutes were spent.

export function retainerError(code: `retainers.${string}`, message: string) {
  return new ConvexError({ code, message });
}

const MS_PER_DAY = 86_400_000;

const asDate = (date: string) => new Date(`${date}T00:00:00Z`);
const asString = (date: Date) => date.toISOString().slice(0, 10);

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The invoice day in a given month, falling back to the last day of a month too short for it. */
export function billingDay(year: number, month: number, dayOfMonth: number): string {
  const day = Math.min(dayOfMonth, daysInMonth(year, month));
  return asString(new Date(Date.UTC(year, month, day)));
}

/** The period that starts on `start`: it runs to the day before the same day next month. */
export function periodFrom(start: string, invoiceDayOfMonth: number): { periodStart: string; periodEnd: string } {
  const from = asDate(start);
  const next = billingDay(from.getUTCFullYear(), from.getUTCMonth() + 1, invoiceDayOfMonth);
  return { periodStart: start, periodEnd: asString(new Date(asDate(next).getTime() - MS_PER_DAY)) };
}

/** The first period of a retainer starts the day it does, and ends the day before the next invoice day. */
export function firstPeriod(startDate: string, invoiceDayOfMonth: number) {
  const from = asDate(startDate);
  const thisMonth = billingDay(from.getUTCFullYear(), from.getUTCMonth(), invoiceDayOfMonth);
  // Started on or before this month's invoice day, so the first period runs to it; otherwise to next month's.
  const end =
    startDate < thisMonth ? thisMonth : billingDay(from.getUTCFullYear(), from.getUTCMonth() + 1, invoiceDayOfMonth);
  return { periodStart: startDate, periodEnd: asString(new Date(asDate(end).getTime() - MS_PER_DAY)) };
}

export function assertRetainerTerms(terms: {
  monthlyFeeMinor: number;
  includedMinutes: number;
  overageRateMinor: number;
  invoiceDayOfMonth: number;
}) {
  if (terms.monthlyFeeMinor <= 0) throw retainerError('retainers.invalid', 'A retainer needs a monthly fee');
  if (terms.includedMinutes < 0 || !Number.isInteger(terms.includedMinutes)) {
    throw retainerError('retainers.invalid', 'Included minutes must be a whole number');
  }
  if (terms.overageRateMinor < 0) throw retainerError('retainers.invalid', 'An overage rate cannot be negative');
  if (!Number.isInteger(terms.invoiceDayOfMonth) || terms.invoiceDayOfMonth < 1 || terms.invoiceDayOfMonth > 31) {
    throw retainerError('retainers.invalid', 'The invoice day must be a day of the month');
  }
}

export type PeriodUsage = { includedMinutes: number; rolloverMinutes: number; usedMinutes: number };

/**
 * How a period's minutes were spent. Rollover is used first, so carried minutes are not lost while the period's own
 * minutes are spent; only the period's own unused minutes can carry on, which is what keeps rollover to one month.
 */
export function splitUsage(period: PeriodUsage): {
  fromRolloverMinutes: number;
  fromIncludedMinutes: number;
  overageMinutes: number;
  remainingMinutes: number;
  rollsOverMinutes: number;
} {
  const fromRolloverMinutes = Math.min(period.usedMinutes, period.rolloverMinutes);
  const afterRollover = period.usedMinutes - fromRolloverMinutes;
  const fromIncludedMinutes = Math.min(afterRollover, period.includedMinutes);
  const overageMinutes = afterRollover - fromIncludedMinutes;
  const allowed = period.includedMinutes + period.rolloverMinutes;
  return {
    fromRolloverMinutes,
    fromIncludedMinutes,
    overageMinutes,
    remainingMinutes: Math.max(0, allowed - period.usedMinutes),
    // Only this period's own minutes carry on; anything carried into it expires here.
    rollsOverMinutes: period.includedMinutes - fromIncludedMinutes,
  };
}

/** Where usage stands, for the alerts at 80% and 100% of what the period allows. */
export function usageBps(period: PeriodUsage): number {
  const allowed = period.includedMinutes + period.rolloverMinutes;
  if (allowed <= 0) return period.usedMinutes > 0 ? 10_000 : 0;
  return Math.round((period.usedMinutes / allowed) * 10_000);
}

export const hoursFrom = (minutes: number) => {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
};
