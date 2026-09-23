import { ConvexError } from 'convex/values';
import { type Doc } from '../_generated/dataModel';
import { applyBps, type Currency, formatMoney } from './money';

// Billing schedule rules (08-billing-and-finance.md, Billing schedules). A schedule spreads a fixed-price project's
// amount across items, each raising an invoice when its trigger fires. Amounts only ever come from money.ts.

export function scheduleError(code: `schedules.${string}`, message: string) {
  return new ConvexError({ code, message });
}

export type ScheduleItem = Doc<'billingSchedules'>['items'][number];

/** The default for a new fixed-price project (08-billing-and-finance.md): half on signature, half on final approval. */
export const DEFAULT_SPLIT = [
  { label: 'On signature', bps: 5_000, trigger: 'on_signature' as const },
  { label: 'On final approval', bps: 5_000, trigger: 'on_milestone_approved' as const },
];

/** A percent item is that share of the project's amount; a fixed one is what it says. */
export function itemAmountMinor(
  item: { kind: 'percent' | 'fixed'; bps?: number; amountMinor?: number },
  projectAmountMinor: number,
): number {
  if (item.kind === 'percent') {
    if (item.bps === undefined) throw scheduleError('schedules.invalid', 'A percentage item needs a percentage');
    return applyBps(projectAmountMinor, item.bps);
  }
  if (item.amountMinor === undefined) throw scheduleError('schedules.invalid', 'A fixed item needs an amount');
  return item.amountMinor;
}

/** Everything the items add up to. */
export const scheduledTotalMinor = (items: readonly { amountMinor: number }[]) =>
  items.reduce((sum, item) => sum + item.amountMinor, 0);

/**
 * A schedule can only be activated once its items add up to the project's amount, so a project is never part-billed by
 * accident (08-billing-and-finance.md).
 */
export function assertAddsUp(items: readonly { amountMinor: number }[], amountMinor: number, currency: Currency) {
  const total = scheduledTotalMinor(items);
  if (total !== amountMinor) {
    throw scheduleError(
      'schedules.mismatch',
      `The items add up to ${formatMoney(total, currency)}, but the project is ${formatMoney(amountMinor, currency)}`,
    );
  }
}

/** Items waiting on a trigger, in the order they were written. */
export const pendingItems = (schedule: Doc<'billingSchedules'>, trigger: ScheduleItem['trigger']) =>
  schedule.items.filter((item) => item.status === 'pending' && item.trigger === trigger);
