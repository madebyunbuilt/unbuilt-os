import { ConvexError } from 'convex/values';
import { type Doc } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type TeamPrincipal } from './principals';

// Time tracking (06-projects.md, Time tracking). Entries keep the rates that applied when they were logged, so a later
// rate change never rewrites history. Approval rules decided by the studio on 2026-09-15:
//   - nobody approves their own time, except the Owner;
//   - project managers approve time on projects they manage; the Owner and Admins approve any project;
//   - time logged before Finance sets someone's rates is kept and flagged, not blocked.

type Ctx = QueryCtx | MutationCtx;

export function timeError(code: `time.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** The longest single entry: a whole day. */
export const MAX_ENTRY_MINUTES = 24 * 60;
/** A timer left running longer than this is capped when it is stopped. */
export const MAX_TIMER_MINUTES = 12 * 60;

export const LOCKED_STATUSES: ReadonlySet<Doc<'timeEntries'>['status']> = new Set(['approved', 'invoiced']);

/** The Monday of the week a YYYY-MM-DD date falls in. */
export function weekStartOf(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - weekday * 86_400_000).toISOString().slice(0, 10);
}

export function checkedMinutes(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_ENTRY_MINUTES) {
    throw timeError('time.invalid', 'Log between 1 minute and 24 hours on an entry');
  }
  return minutes;
}

/** The member's rates as they stand now, copied onto the entry. Absent rates are recorded as missing. */
export function ratesFor(member: Doc<'teamMembers'>) {
  return {
    costRateMinor: member.costRateMinor,
    billRateMinor: member.billRateMinor,
    rateCurrency:
      member.costRateMinor === undefined && member.billRateMinor === undefined ? undefined : member.rateCurrency,
  };
}

/** Whether the caller may decide this entry: not their own unless they are the Owner, and within their reach. */
export async function canApprove(
  ctx: Ctx,
  principal: TeamPrincipal,
  entry: Pick<Doc<'timeEntries'>, 'memberId' | 'projectId'>,
  isOwner: boolean,
): Promise<boolean> {
  if (!principal.permissions.has('time.approve')) return false;
  if (entry.memberId === principal.member._id && !isOwner) return false;
  // Owner and Admins reach every project; a project manager reaches the projects they manage.
  if (principal.permissions.has('time.edit.all') || isOwner) return true;
  const project = await ctx.db.get('projects', entry.projectId);
  return project?.managerMemberId === principal.member._id;
}

/** Whether the caller may change or delete this entry. */
export async function canEditEntry(
  ctx: Ctx,
  principal: TeamPrincipal,
  entry: Doc<'timeEntries'>,
  isOwner: boolean,
): Promise<boolean> {
  if (entry.status === 'invoiced') return false;
  if (entry.status === 'approved') return principal.permissions.has('time.edit.all');
  if (entry.memberId === principal.member._id) return principal.permissions.has('time.log.own');
  if (principal.permissions.has('time.edit.all')) return true;
  return await canApprove(ctx, principal, entry, isOwner);
}

export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(2).replace(/0$/, '')}h`;
}
