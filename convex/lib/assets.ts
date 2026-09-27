import { ConvexError } from 'convex/values';
import { type Doc } from '../_generated/dataModel';
import { addDays } from './timeOffFormat';

// Renewals (09-support-and-sla.md, Managed assets and renewals). Everything here is about one question: how long
// before a thing the studio keeps alive for a client stops working, and who has been told.

export function assetError(code: `assets.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** Days before a renewal that somebody is told. Widest first, which is the order they fire in. */
export const REMINDER_DAYS = [60, 30, 14, 7] as const;

/** From this point the client's billing contacts hear about it too, not only the studio. */
export const TELL_CLIENT_FROM_DAYS = 30;

/** The same point at which `autoInvoice` drafts the renewal invoice. */
export const AUTO_INVOICE_DAYS = 30;

/** Whole days from `today` to the renewal, negative once it has passed. Both are YYYY-MM-DD. */
export function daysUntil(renewsOnDate: string, today: string): number {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${renewsOnDate}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * The thresholds that have come due and have not been sent. A gap in the reminders — nobody looked for a fortnight,
 * or the asset was added late — still sends the ones that were missed, because the point is that somebody knows,
 * not that a calendar was kept.
 */
export function remindersDue(asset: Doc<'managedAssets'>, today: string): number[] {
  if (asset.status !== 'active') return [];
  const days = daysUntil(asset.renewsOnDate, today);
  if (days < 0) return [];
  return REMINDER_DAYS.filter((threshold) => days <= threshold && !asset.remindersSent.includes(threshold));
}

/** Whether this reminder is close enough that the client hears about it as well as the studio. */
export function tellsClient(threshold: number): boolean {
  return threshold <= TELL_CLIENT_FROM_DAYS;
}

/** A year on, which is what a domain or a certificate almost always means, and a starting point the studio can change. */
export function nextYear(renewsOnDate: string): string {
  const [year, month, day] = renewsOnDate.split('-').map(Number);
  // The 29th of February renews on the 28th in a common year rather than slipping into March.
  const target = new Date(Date.UTC(year + 1, month - 1, day));
  return target.getUTCMonth() === month - 1
    ? target.toISOString().slice(0, 10)
    : addDays(new Date(Date.UTC(year + 1, month - 1, 1)).toISOString().slice(0, 10), 27);
}

/** How a renewal reads to somebody being told about it. */
export function renewalSummary(asset: Doc<'managedAssets'>, days: number): string {
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return `${asset.name} (${asset.provider}) renews ${when}`;
}
