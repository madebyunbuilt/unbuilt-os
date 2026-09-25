import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { addBusinessMinutes, type BusinessCalendar, businessMinutesBetween, type Holiday } from './businessTime';

// SLA timers for tickets (09-support-and-sla.md). Every due time here goes through businessTime, so a promise of
// "4 hours" means four hours the studio is actually open, and never a weekend, a holiday or an evening.

type Ctx = QueryCtx | MutationCtx;

export type Priority = Doc<'tickets'>['priority'];
export type TicketStatus = Doc<'tickets'>['status'];

export function slaError(code: `tickets.${string}` | `sla.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/**
 * The calendar an SLA policy counts in, with the holidays that fall inside it. Holidays are read whole rather than by
 * range: a ticket raised in December is measured against January's holidays too, and there are a few dozen rows.
 */
export async function calendarFor(
  ctx: Ctx,
  policy: Doc<'slaPolicies'>,
): Promise<{ calendar: BusinessCalendar; holidays: Holiday[] }> {
  const hours = await ctx.db.get('businessHours', policy.businessHoursId);
  if (!hours) throw slaError('sla.noCalendar', `${policy.name} has no business hours`);
  const holidays = await ctx.db.query('holidays').collect();
  return {
    calendar: { timezone: hours.timezone, weekly: hours.weekly },
    holidays: holidays.map(({ date, recurring }) => ({ date, recurring })),
  };
}

/**
 * The policy a ticket is measured against: the project's, then the client's, then none (09-support-and-sla.md, SLA
 * policies). An inactive policy is treated as none, so retiring a policy stops new promises without rewriting the
 * tickets already made under it.
 */
export async function policyForTicket(
  ctx: Ctx,
  args: { clientId: Id<'clients'>; projectId?: Id<'projects'> },
): Promise<Doc<'slaPolicies'> | null> {
  const project = args.projectId ? await ctx.db.get('projects', args.projectId) : null;
  const ids = [project?.slaPolicyId, (await ctx.db.get('clients', args.clientId))?.slaPolicyId];
  for (const id of ids) {
    if (!id) continue;
    const policy = await ctx.db.get('slaPolicies', id);
    if (policy?.active) return policy;
  }
  return null;
}

export function targetFor(policy: Doc<'slaPolicies'>, priority: Priority) {
  return policy.targets.find((target) => target.priority === priority) ?? null;
}

export type Due = { firstResponseDueAt?: number; resolutionDueAt?: number };

/**
 * When a ticket raised at `from` is due, counted in business time. A priority the policy says nothing about, and a
 * resolution target it leaves out, are best effort: no due time at all rather than one invented here.
 */
export function dueTimes(
  from: number,
  priority: Priority,
  policy: Doc<'slaPolicies'> | null,
  calendar: BusinessCalendar,
  holidays: Holiday[],
): Due {
  const target = policy ? targetFor(policy, priority) : null;
  if (!target) return {};
  return {
    firstResponseDueAt: addBusinessMinutes(from, target.firstResponseMinutes, calendar, holidays),
    resolutionDueAt:
      target.resolutionMinutes === undefined
        ? undefined
        : addBusinessMinutes(from, target.resolutionMinutes, calendar, holidays),
  };
}

/** The due times for a ticket, from its own policy and calendar. */
export async function dueTimesFor(
  ctx: Ctx,
  args: { from: number; priority: Priority; policy: Doc<'slaPolicies'> | null },
): Promise<Due> {
  if (!args.policy) return {};
  const { calendar, holidays } = await calendarFor(ctx, args.policy);
  return dueTimes(args.from, args.priority, args.policy, calendar, holidays);
}

/**
 * Pushing the resolution due time out by the business minutes a ticket spent waiting on the client
 * (09-support-and-sla.md, Timers). The first response target is untouched: a ticket cannot be waiting on the client
 * before the studio has replied to it.
 */
export async function resumeAfterPause(
  ctx: Ctx,
  ticket: Doc<'tickets'>,
  now: number,
): Promise<{ pausedMinutes: number; resolutionDueAt?: number }> {
  if (ticket.pausedAt === undefined) return { pausedMinutes: ticket.pausedMinutes };
  const policy = ticket.slaPolicyId ? await ctx.db.get('slaPolicies', ticket.slaPolicyId) : null;
  if (!policy || ticket.resolutionDueAt === undefined) {
    return { pausedMinutes: ticket.pausedMinutes, resolutionDueAt: ticket.resolutionDueAt };
  }
  const { calendar, holidays } = await calendarFor(ctx, policy);
  const waited = businessMinutesBetween(ticket.pausedAt, now, calendar, holidays);
  return {
    pausedMinutes: ticket.pausedMinutes + waited,
    resolutionDueAt: addBusinessMinutes(ticket.resolutionDueAt, waited, calendar, holidays),
  };
}

/**
 * Due times after a change of priority (studio, 2026-09-25). The clock is re-run from when the ticket was raised under
 * the new priority's targets, then pushed out by whatever it has already spent waiting on the client. Escalating a P3
 * to a P1 therefore makes it due sooner, which is the point of escalating it, and a ticket that is already late says
 * so straight away rather than being handed a fresh hour.
 */
export async function dueTimesAfterPriorityChange(ctx: Ctx, ticket: Doc<'tickets'>, priority: Priority): Promise<Due> {
  const policy = ticket.slaPolicyId ? await ctx.db.get('slaPolicies', ticket.slaPolicyId) : null;
  if (!policy) return {};
  const { calendar, holidays } = await calendarFor(ctx, policy);
  const fresh = dueTimes(ticket.createdAt, priority, policy, calendar, holidays);
  const paused = ticket.pausedMinutes;
  return {
    // A ticket already answered keeps the first response it got; the target only matters until then.
    firstResponseDueAt:
      ticket.firstRespondedAt === undefined
        ? fresh.firstResponseDueAt
        : (ticket.firstResponseDueAt ?? fresh.firstResponseDueAt),
    resolutionDueAt:
      fresh.resolutionDueAt === undefined || paused === 0
        ? fresh.resolutionDueAt
        : addBusinessMinutes(fresh.resolutionDueAt, paused, calendar, holidays),
  };
}

export const OPEN_STATUSES: readonly TicketStatus[] = ['new', 'open', 'pending_client'];
