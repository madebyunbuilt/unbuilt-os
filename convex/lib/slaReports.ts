import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { businessMinutesBetween, localDateString } from './businessTime';
import { calendarFor, type Priority } from './sla';

// The figures behind a monthly SLA report (09-support-and-sla.md, Monthly SLA report). Worked out once, when the
// month has closed, and stored: a report is a statement about a period that is over, and must read the same in a year
// as it did on the day it was written.

type Ctx = QueryCtx | MutationCtx;

const PRIORITIES: Priority[] = ['p1', 'p2', 'p3', 'p4'];

/** The first and last day of the month before `date`, as YYYY-MM-DD. */
export function previousMonth(date: string): { periodStart: string; periodEnd: string } {
  const [year, month] = date.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 2, 1));
  const end = new Date(Date.UTC(year, month - 1, 0));
  return { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10) };
}

/**
 * Compliance as basis points, the same unit as every other percentage here. Absent rather than 100% when nothing was
 * promised: a month with no P1 tickets did not meet its P1 target, it simply never had one.
 */
function complianceBps(met: number, promised: number): number | undefined {
  return promised === 0 ? undefined : Math.round((met / promised) * 10_000);
}

/** Whether a ticket was answered, and resolved, within what it was promised. */
function outcome(ticket: Doc<'tickets'>) {
  const answeredInTime =
    ticket.firstResponseDueAt === undefined
      ? null
      : ticket.firstRespondedAt !== undefined && ticket.firstRespondedAt <= ticket.firstResponseDueAt;
  const resolvedInTime =
    ticket.resolutionDueAt === undefined
      ? null
      : ticket.resolvedAt !== undefined && ticket.resolvedAt <= ticket.resolutionDueAt;
  return { answeredInTime, resolvedInTime };
}

export type Figures = {
  byPriority: Doc<'slaReports'>['byPriority'];
  breaches: Doc<'slaReports'>['breaches'];
};

/**
 * What a month looked like for one client. A ticket counts toward the month it was raised in, so a report covers what
 * the client asked for in that month rather than whatever happened to be open at the end of it.
 */
export async function figuresFor(
  ctx: Ctx,
  args: { clientId: Id<'clients'>; policy: Doc<'slaPolicies'>; periodStart: string; periodEnd: string },
): Promise<Figures> {
  const { calendar, holidays } = await calendarFor(ctx, args.policy);
  const day = (at: number) => localDateString(at, calendar.timezone);

  const tickets = (
    await ctx.db
      .query('tickets')
      .withIndex('by_client', (q) => q.eq('clientId', args.clientId))
      .collect()
  ).filter((ticket) => {
    const raised = day(ticket.createdAt);
    return raised >= args.periodStart && raised <= args.periodEnd;
  });

  const byPriority = PRIORITIES.map((priority) => {
    const mine = tickets.filter((ticket) => ticket.priority === priority);
    const answered = mine.map(outcome);
    const firstResponse = answered.filter((o) => o.answeredInTime !== null);
    const resolution = answered.filter((o) => o.resolvedInTime !== null);
    return {
      priority,
      opened: mine.length,
      resolved: mine.filter((ticket) => ticket.resolvedAt !== undefined).length,
      firstResponseComplianceBps: complianceBps(
        firstResponse.filter((o) => o.answeredInTime).length,
        firstResponse.length,
      ),
      resolutionComplianceBps: complianceBps(resolution.filter((o) => o.resolvedInTime).length, resolution.length),
    };
  });

  const breaches: Figures['breaches'] = [];
  for (const ticket of tickets) {
    const { answeredInTime, resolvedInTime } = outcome(ticket);
    const missed: { target: 'firstResponse' | 'resolution'; dueAt: number; metAt?: number }[] = [];
    if (answeredInTime === false) {
      missed.push({ target: 'firstResponse', dueAt: ticket.firstResponseDueAt!, metAt: ticket.firstRespondedAt });
    }
    if (resolvedInTime === false) {
      missed.push({ target: 'resolution', dueAt: ticket.resolutionDueAt!, metAt: ticket.resolvedAt });
    }
    for (const { target, dueAt, metAt } of missed) {
      breaches.push({
        ticketId: ticket._id,
        number: ticket.number,
        subject: ticket.subject,
        priority: ticket.priority,
        target,
        // Measured to when it was met, or to the end of the month for something still outstanding: counting to "now"
        // would make an old report grow every time somebody opened it.
        lateMinutes: businessMinutesBetween(
          dueAt,
          metAt ?? Date.parse(`${args.periodEnd}T23:59:59Z`),
          calendar,
          holidays,
        ),
        reason: ticket.breachReason,
      });
    }
  }
  breaches.sort((a, b) => b.lateMinutes - a.lateMinutes);
  return { byPriority, breaches };
}

/** The retainer hours a client used in the period, where they have a retainer at all. */
export async function retainerMinutesFor(
  ctx: Ctx,
  args: { clientId: Id<'clients'>; periodStart: string; periodEnd: string },
): Promise<{ included: number; used: number } | undefined> {
  const retainers = (await ctx.db.query('retainers').take(500)).filter(
    (retainer) => retainer.clientId === args.clientId,
  );
  let included = 0;
  let used = 0;
  let found = false;
  for (const retainer of retainers) {
    const periods = await ctx.db
      .query('retainerPeriods')
      .withIndex('by_retainer_start', (q) => q.eq('retainerId', retainer._id))
      .collect();
    for (const period of periods) {
      // Any period overlapping the month: a retainer that runs to the 15th still spent hours in it.
      if (period.periodEnd < args.periodStart || period.periodStart > args.periodEnd) continue;
      included += period.includedMinutes + period.rolloverMinutes;
      used += period.usedMinutes;
      found = true;
    }
  }
  return found ? { included, used } : undefined;
}

export type Monitoring = {
  uptime: NonNullable<Doc<'slaReports'>['uptime']>;
  incidents: NonNullable<Doc<'slaReports'>['incidents']>;
  monitored: boolean;
};

/**
 * How the things the studio watches behaved over the month (09-support-and-sla.md, Uptime monitoring). Worked out
 * when the month closes and stored: checks are kept for ninety days, and this figure has to outlive them.
 *
 * Uptime is passing checks over checks actually made. Paused time needs no arithmetic — no check is recorded while a
 * monitor is paused, so a period nobody was asked to watch simply is not in the figure.
 */
export async function monitoringFor(
  ctx: Ctx,
  args: { clientId: Id<'clients'>; periodStart: string; periodEnd: string; targetBps?: number },
): Promise<Monitoring> {
  const monitors = await ctx.db
    .query('monitors')
    .withIndex('by_client', (q) => q.eq('clientId', args.clientId))
    .collect();
  if (monitors.length === 0) return { uptime: [], incidents: [], monitored: false };

  const from = Date.parse(`${args.periodStart}T00:00:00Z`);
  const to = Date.parse(`${args.periodEnd}T23:59:59.999Z`);

  const uptime: Monitoring['uptime'] = [];
  const incidents: Monitoring['incidents'] = [];

  for (const monitor of monitors) {
    const checks = await ctx.db
      .query('monitorChecks')
      .withIndex('by_monitor_time', (q) => q.eq('monitorId', monitor._id).gte('checkedAt', from).lte('checkedAt', to))
      .collect();
    // A monitor added mid-month, or paused throughout, has nothing to report rather than a perfect record.
    if (checks.length > 0) {
      const passed = checks.filter((check) => check.ok).length;
      uptime.push({
        monitorId: monitor._id,
        name: monitor.name,
        url: monitor.url,
        checks: checks.length,
        passed,
        uptimeBps: Math.round((passed / checks.length) * 10_000),
        targetBps: args.targetBps,
      });
    }

    for (const incident of await ctx.db
      .query('incidents')
      .withIndex('by_monitor_started', (q) =>
        q.eq('monitorId', monitor._id).gte('startedAt', from).lte('startedAt', to),
      )
      .collect()) {
      const ticket = incident.ticketId ? await ctx.db.get('tickets', incident.ticketId) : null;
      incidents.push({
        monitorName: monitor.name,
        startedAt: incident.startedAt,
        resolvedAt: incident.resolvedAt,
        // Measured to the end of the month for one still running, so an old report does not grow when it is opened.
        downMinutes: Math.max(1, Math.round(((incident.resolvedAt ?? to) - incident.startedAt) / 60_000)),
        ticketNumber: ticket?.number,
        summary: incident.summary,
      });
    }
  }

  uptime.sort((a, b) => a.uptimeBps - b.uptimeBps || a.name.localeCompare(b.name));
  incidents.sort((a, b) => a.startedAt - b.startedAt);
  return { uptime, incidents, monitored: true };
}
