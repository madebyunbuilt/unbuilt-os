import { ConvexError } from 'convex/values';
import { applyBps } from './money';

// Late fees (08-billing-and-finance.md, Late fees). An invoice still unpaid after its due date and the grace period
// earns a monthly fee on what is still owed. The fee is a **separate** invoice so the original is never rewritten, and
// it is charged on the parent's balance only, never on earlier late fees, so nothing compounds.

export function lateFeeError(code: `lateFees.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** A month later, to the day; a day past the end of a short month falls on its last day. */
export function oneMonthOn(date: string): string {
  const from = new Date(`${date}T00:00:00Z`);
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(from.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

export type LateFeePolicy = { enabled: boolean; monthlyBps: number; graceDays?: number; autoSend?: boolean };

/**
 * Whether a late fee falls due today, and what it is worth. `chargedOn` is the day of the last late fee raised for this
 * invoice, so the next one waits a whole month: at most one fee per invoice per month, whatever the cron does.
 */
export function lateFeeDue(
  invoice: { dueDate?: string; balanceMinor: number },
  policy: LateFeePolicy,
  today: string,
  chargedOn: string | undefined,
): { amountMinor: number } | null {
  if (!policy.enabled || !invoice.dueDate || invoice.balanceMinor <= 0) return null;
  const from = chargedOn ? oneMonthOn(chargedOn) : addDaysTo(invoice.dueDate, policy.graceDays ?? 0);
  if (today < from) return null;
  // On the balance still owed, never on a fee already charged.
  const amountMinor = applyBps(invoice.balanceMinor, policy.monthlyBps);
  return amountMinor > 0 ? { amountMinor } : null;
}

const addDaysTo = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
