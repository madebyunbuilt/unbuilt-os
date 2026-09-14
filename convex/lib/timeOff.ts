import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx } from '../_generated/server';
import { type Holiday, type WeeklyHours } from './businessTime';
import { isOwner } from './team';
import { type TeamPrincipal } from './principals';
import { isIsoDate } from './validation';
import { datesBetween, DAY_MS, toUtc } from './timeOffFormat';

export {
  addDays,
  datesBetween,
  formatDateRange,
  formatDays,
  TIME_OFF_TYPES,
  type TimeOffType,
  TYPE_LABELS,
} from './timeOffFormat';

// Time off (11-team.md, Time off). Dates are whole calendar days in the studio's timezone, written YYYY-MM-DD.

/** The longest single request, in calendar days. */
export const MAX_TIME_OFF_DAYS = 366;
export const MAX_NOTE_LENGTH = 500;

export function timeOffError(code: `timeOff.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** Checks the dates and half day, and returns them normalised. */
export function validateDates(input: { startDate: string; endDate: string; halfDay: boolean }) {
  const { startDate, endDate, halfDay } = input;
  if (!isIsoDate(startDate) || !isIsoDate(endDate))
    throw timeOffError('timeOff.invalid', 'Choose a start and end date');
  if (endDate < startDate) throw timeOffError('timeOff.invalid', 'The end date must be on or after the start date');
  if ((toUtc(endDate) - toUtc(startDate)) / DAY_MS + 1 > MAX_TIME_OFF_DAYS) {
    throw timeOffError('timeOff.invalid', `Time off can be at most ${MAX_TIME_OFF_DAYS} days at once`);
  }
  if (halfDay && startDate !== endDate)
    throw timeOffError('timeOff.invalid', 'A half day must start and end on the same day');
  return { startDate, endDate, halfDay };
}

export function optionalNote(value: string | undefined, label = 'Note'): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw timeOffError('timeOff.invalid', `${label} can be at most ${MAX_NOTE_LENGTH} characters`);
  }
  return trimmed;
}

/**
 * Working days the time off covers: days with business hours that are not public holidays. A half day counts 0.5.
 * This is what the request costs; holidays and weekends inside the range are free.
 */
export function workingDays(
  range: { startDate: string; endDate: string; halfDay: boolean },
  weekly: readonly WeeklyHours[],
  holidays: readonly Holiday[],
): number {
  const workingWeekdays = new Set(weekly.map((hours) => hours.day));
  const dated = new Set(holidays.filter((h) => !h.recurring).map((h) => h.date));
  const recurring = new Set(holidays.filter((h) => h.recurring).map((h) => h.date.slice(5)));
  let days = 0;
  for (const date of datesBetween(range.startDate, range.endDate)) {
    if (!workingWeekdays.has(new Date(toUtc(date)).getUTCDay())) continue;
    if (dated.has(date) || recurring.has(date.slice(5))) continue;
    days++;
  }
  return range.halfDay ? days / 2 : days;
}

/** Holds timeoff.approve and the time off is not their own, unless they are the Owner (11-team.md). */
export function canDecide(principal: TeamPrincipal, record: Pick<Doc<'timeOff'>, 'memberId'>): boolean {
  if (!principal.permissions.has('timeoff.approve')) return false;
  return record.memberId !== principal.member._id || isOwner(principal.role);
}

/**
 * Members cancel their own requests at any time and their approved time off until its first day; after that an approver
 * cancels it. Approvers cancel anyone's requested or approved time off, but their own only as the Owner.
 */
export function canCancel(principal: TeamPrincipal, record: Doc<'timeOff'>, today: string): boolean {
  if (record.status !== 'requested' && record.status !== 'approved') return false;
  if (canDecide(principal, record)) return true;
  if (record.memberId !== principal.member._id) return false;
  return record.status === 'requested' || today < record.startDate;
}

/** Who may see the type, note and decision note: the member and approvers. Everyone else sees only that they are off. */
export function canSeeDetails(principal: TeamPrincipal, record: Pick<Doc<'timeOff'>, 'memberId'>): boolean {
  return record.memberId === principal.member._id || principal.permissions.has('timeoff.approve');
}

/**
 * On offboarding: pending requests, and approved time off that starts after the last day, no longer apply. Past and
 * current time off stays as history.
 */
export async function cancelOpenTimeOff(
  ctx: { db: MutationCtx['db'] },
  memberId: Id<'teamMembers'>,
  lastDay: string,
  cancelledBy: Id<'teamMembers'>,
): Promise<number> {
  const records = await ctx.db
    .query('timeOff')
    .withIndex('by_member_start', (q) => q.eq('memberId', memberId))
    .collect();
  const open = records.filter((r) => r.status === 'requested' || (r.status === 'approved' && r.startDate > lastDay));
  const cancelledAt = Date.now();
  for (const r of open) await ctx.db.patch('timeOff', r._id, { status: 'cancelled', cancelledBy, cancelledAt });
  return open.length;
}
