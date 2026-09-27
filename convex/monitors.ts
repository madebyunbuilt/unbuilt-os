import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { getClient, recordActivity, text } from './lib/crm';
import { internalAction, internalMutation, teamMutation, teamQuery } from './lib/functions';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { openTicket } from './tickets';

// Uptime monitoring (09-support-and-sla.md). A monitor exists so that the studio finds out a site is down before the
// client rings to say so, and so that what happened is on the record afterwards.

/** One failure is a blip — a deploy, a dropped packet. The second is something worth waking somebody for. */
export const FAILURES_BEFORE_INCIDENT = 2;

/** History is kept for 90 days (09-support-and-sla.md); the month's figure is stored on the SLA report for good. */
export const CHECK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** The period an uptime figure covers on screen. The month's figure is stored on the SLA report for good. */
export const UPTIME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_INTERVAL_MINUTES = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

function monitorError(code: `monitors.${string}`, message: string) {
  return new ConvexError({ code, message });
}

function view(monitor: Doc<'monitors'>) {
  return {
    id: monitor._id,
    clientId: monitor.clientId,
    projectId: monitor.projectId,
    name: monitor.name,
    url: monitor.url,
    method: monitor.method,
    expectedStatus: monitor.expectedStatus,
    intervalMinutes: monitor.intervalMinutes,
    timeoutMs: monitor.timeoutMs,
    production: monitor.production,
    status: monitor.status,
    lastCheckedAt: monitor.lastCheckedAt,
    lastStatusCode: monitor.lastStatusCode,
    consecutiveFailures: monitor.consecutiveFailures,
  };
}

async function getMonitor(ctx: QueryCtx | MutationCtx, monitorId: Id<'monitors'>): Promise<Doc<'monitors'>> {
  const monitor = await ctx.db.get('monitors', monitorId);
  if (!monitor) throw monitorError('monitors.notFound', 'That monitor is not here');
  return monitor;
}

/** Only somewhere a request can actually be sent, and never inside the studio's own network. */
function checkedUrl(raw: string): string {
  const typed = raw.trim();
  let url: URL;
  try {
    // Somebody typing glossup.com means https://glossup.com; making them type the scheme buys nothing. An explicit
    // http:// is left alone, because that is a real choice about what is being watched.
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    throw monitorError('monitors.invalid', 'That is not a URL Unbuilt can check');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw monitorError('monitors.invalid', 'A monitor checks an http or https address');
  }
  const host = url.hostname.toLowerCase();
  // A monitor that could be pointed at localhost or a private range would be a way to make the studio's own servers
  // fetch things on somebody else's behalf.
  const privateHost =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '[::1]';
  if (privateHost) throw monitorError('monitors.invalid', 'A monitor cannot point inside a private network');
  return url.toString();
}

export const list = teamQuery('monitors.manage')({
  args: { clientId: v.optional(v.id('clients')) },
  handler: async (ctx, { clientId }) => {
    const monitors = clientId
      ? await ctx.db
          .query('monitors')
          .withIndex('by_client', (q) => q.eq('clientId', clientId))
          .collect()
      : await ctx.db.query('monitors').take(500);
    return await Promise.all(
      monitors
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (monitor) => ({
          ...view(monitor),
          clientName: (await ctx.db.get('clients', monitor.clientId))?.displayName ?? 'Unknown client',
        })),
    );
  },
});

export const get = teamQuery('monitors.manage')({
  args: { monitorId: v.id('monitors') },
  handler: async (ctx, { monitorId }) => {
    const monitor = await ctx.db.get('monitors', monitorId);
    if (!monitor) return null;
    const checks = await ctx.db
      .query('monitorChecks')
      .withIndex('by_monitor_time', (q) => q.eq('monitorId', monitorId))
      .order('desc')
      .take(50);
    const incidents = await ctx.db
      .query('incidents')
      .withIndex('by_monitor_started', (q) => q.eq('monitorId', monitorId))
      .order('desc')
      .take(20);

    // Uptime over the last 30 days: passing checks against the checks that were actually made
    // (09-support-and-sla.md). Paused time is absent because no check is recorded while paused, so it cannot count
    // against the figure.
    const since = Date.now() - UPTIME_WINDOW_MS;
    const window = await ctx.db
      .query('monitorChecks')
      .withIndex('by_monitor_time', (q) => q.eq('monitorId', monitorId).gte('checkedAt', since))
      .collect();
    const passed = window.filter((check) => check.ok).length;

    return {
      ...view(monitor),
      clientName: (await ctx.db.get('clients', monitor.clientId))?.displayName ?? 'Unknown client',
      // Absent rather than 100% when nothing has been checked yet: no checks is not a perfect record.
      uptimeBps: window.length === 0 ? undefined : Math.round((passed / window.length) * 10_000),
      checksInWindow: window.length,
      checks: checks.map((check) => ({
        id: check._id,
        checkedAt: check.checkedAt,
        ok: check.ok,
        statusCode: check.statusCode,
        latencyMs: check.latencyMs,
        error: check.error,
      })),
      incidents: incidents.map((incident) => ({
        id: incident._id,
        startedAt: incident.startedAt,
        resolvedAt: incident.resolvedAt,
        ticketId: incident.ticketId,
        summary: incident.summary,
      })),
    };
  },
});

export const create = teamMutation('monitors.manage')({
  args: {
    clientId: v.id('clients'),
    projectId: v.optional(v.id('projects')),
    name: v.string(),
    url: v.string(),
    method: v.optional(v.union(v.literal('GET'), v.literal('HEAD'))),
    expectedStatus: v.optional(v.number()),
    intervalMinutes: v.optional(v.number()),
    timeoutMs: v.optional(v.number()),
    production: v.boolean(),
  },
  handler: async (ctx, args) => {
    await getClient(ctx, args.clientId);
    if (args.projectId) {
      const project = await ctx.db.get('projects', args.projectId);
      if (!project || project.clientId !== args.clientId) {
        throw monitorError('monitors.invalid', 'That project does not belong to this client');
      }
    }
    const interval = args.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
    if (interval < 1 || interval > 1440) {
      throw monitorError('monitors.invalid', 'Check between once a minute and once a day');
    }
    return await ctx.db.insert('monitors', {
      clientId: args.clientId,
      projectId: args.projectId,
      name: text(args.name, 'Name', { required: true, max: 120 })!,
      url: checkedUrl(args.url),
      method: args.method ?? 'GET',
      expectedStatus: args.expectedStatus ?? 200,
      intervalMinutes: interval,
      timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      production: args.production,
      // Nothing is claimed about a monitor until it has actually been checked.
      status: 'paused',
      consecutiveFailures: 0,
      pausedAt: Date.now(),
      pausedMinutes: 0,
    });
  },
});

/** Starting and stopping. Paused time is not counted against uptime: the studio was asked not to look. */
export const setPaused = teamMutation('monitors.manage')({
  args: { monitorId: v.id('monitors'), paused: v.boolean() },
  handler: async (ctx, { monitorId, paused }) => {
    const monitor = await getMonitor(ctx, monitorId);
    const now = Date.now();
    if (paused) {
      if (monitor.status === 'paused') return;
      await ctx.db.patch('monitors', monitorId, { status: 'paused', pausedAt: now, consecutiveFailures: 0 });
      return;
    }
    if (monitor.status !== 'paused') return;
    await ctx.db.patch('monitors', monitorId, {
      // Nothing is known until the next check, so it starts as up rather than claiming a state it has not seen.
      status: 'up',
      pausedAt: undefined,
      pausedMinutes: monitor.pausedMinutes + (monitor.pausedAt ? Math.round((now - monitor.pausedAt) / 60_000) : 0),
    });
  },
});

export const remove = teamMutation('monitors.manage')({
  args: { monitorId: v.id('monitors') },
  handler: async (ctx, { monitorId }) => {
    const monitor = await getMonitor(ctx, monitorId);
    const open = await ctx.db
      .query('incidents')
      .withIndex('by_monitor_started', (q) => q.eq('monitorId', monitorId))
      .collect();
    if (open.some((incident) => incident.resolvedAt === undefined)) {
      throw monitorError('monitors.openIncident', 'This monitor is in an incident; resolve it before removing it');
    }
    for (const check of await ctx.db
      .query('monitorChecks')
      .withIndex('by_monitor_time', (q) => q.eq('monitorId', monitorId))
      .collect()) {
      await ctx.db.delete('monitorChecks', check._id);
    }
    await ctx.db.delete('monitors', monitorId);
    await recordActivity(ctx, {
      subject: { table: 'clients', id: monitor.clientId },
      clientId: monitor.clientId,
      type: 'system',
      title: `Monitor removed: ${monitor.name}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
    });
  },
});

/** The monitors whose interval has come round, which the cron hands to the action that actually fetches them. */
export const due = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    { monitorId: Id<'monitors'>; url: string; method: string; timeoutMs: number; expectedStatus: number }[]
  > => {
    const now = Date.now();
    const monitors = await ctx.db.query('monitors').take(500);
    return monitors
      .filter((monitor) => monitor.status !== 'paused')
      .filter((monitor) => (monitor.lastCheckedAt ?? 0) + monitor.intervalMinutes * 60_000 <= now)
      .map((monitor) => ({
        monitorId: monitor._id,
        url: monitor.url,
        method: monitor.method,
        timeoutMs: monitor.timeoutMs,
        expectedStatus: monitor.expectedStatus,
      }));
  },
});

/**
 * Recording what a check found, and deciding whether it means anything. Two failures in a row open an incident and
 * raise a ticket, so the work of putting it right is tracked where every other piece of work is.
 */
export const record = internalMutation({
  args: {
    monitorId: v.id('monitors'),
    ok: v.boolean(),
    statusCode: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const monitor = await ctx.db.get('monitors', args.monitorId);
    // Removed or paused while the request was in flight: the answer is no longer wanted.
    if (!monitor || monitor.status === 'paused') return;
    const now = Date.now();

    await ctx.db.insert('monitorChecks', {
      monitorId: args.monitorId,
      checkedAt: now,
      ok: args.ok,
      statusCode: args.statusCode,
      latencyMs: args.latencyMs,
      error: args.error,
    });

    const failures = args.ok ? 0 : monitor.consecutiveFailures + 1;
    await ctx.db.patch('monitors', args.monitorId, {
      lastCheckedAt: now,
      lastStatusCode: args.statusCode,
      consecutiveFailures: failures,
      status: failures >= FAILURES_BEFORE_INCIDENT ? 'down' : args.ok ? 'up' : monitor.status,
    });

    const openIncident = (
      await ctx.db
        .query('incidents')
        .withIndex('by_monitor_started', (q) => q.eq('monitorId', args.monitorId))
        .order('desc')
        .take(1)
    ).find((incident) => incident.resolvedAt === undefined);

    if (!args.ok && failures >= FAILURES_BEFORE_INCIDENT && !openIncident) {
      await openIncidentFor(ctx, monitor, { now, error: args.error, statusCode: args.statusCode });
    } else if (args.ok && openIncident) {
      await resolveIncident(ctx, monitor, openIncident, now);
    }
  },
});

/** What a client's site being down is called, and who is told about it. */
async function openIncidentFor(
  ctx: MutationCtx,
  monitor: Doc<'monitors'>,
  args: { now: number; error?: string; statusCode?: number },
) {
  const said = args.error ?? `returned ${args.statusCode ?? 'no response'}`;
  const summary = `${monitor.name} ${said}`;

  // A production outage is a P1; anything else is serious but not somebody's night.
  const ticketId = await openTicket(ctx, {
    clientId: monitor.clientId,
    projectId: monitor.projectId,
    subject: `${monitor.name} is down`,
    description: `Unbuilt's monitor could not reach ${monitor.url}: ${said}.`,
    priority: monitor.production ? 'p1' : 'p2',
    channel: 'monitor',
    now: args.now,
  });

  const incidentId = await ctx.db.insert('incidents', {
    monitorId: monitor._id,
    clientId: monitor.clientId,
    startedAt: args.now,
    ticketId,
    summary,
  });

  const team = await monitorWatchers(ctx, monitor);
  await notifyTeamMembers(
    ctx,
    team,
    {
      event: 'monitor.down',
      title: `${monitor.name} is down`,
      body: `${monitor.url} ${said}.`,
      link: `/support/monitors/${monitor._id}`,
    },
    // A production site being down is the one thing worth a message outside the app.
    monitor.production ? { whatsapp: true } : {},
  );
  await recordActivity(ctx, {
    subject: { table: 'clients', id: monitor.clientId },
    clientId: monitor.clientId,
    type: 'system',
    title: summary,
    actor: { kind: 'system' },
    occurredAt: args.now,
  });
  return incidentId;
}

/** The first passing check ends it: the incident closes, the team is told, and the ticket says so. */
async function resolveIncident(ctx: MutationCtx, monitor: Doc<'monitors'>, incident: Doc<'incidents'>, now: number) {
  await ctx.db.patch('incidents', incident._id, { resolvedAt: now });
  const downMinutes = Math.max(1, Math.round((now - incident.startedAt) / 60_000));

  if (incident.ticketId) {
    await ctx.db.insert('ticketMessages', {
      ticketId: incident.ticketId,
      visibility: 'public',
      body: `${monitor.name} is answering again. It was unreachable for about ${downMinutes} minute${downMinutes === 1 ? '' : 's'}.`,
      authorKind: 'system',
      fileIds: [],
      createdAt: now,
    });
  }
  await notifyTeamMembers(ctx, await monitorWatchers(ctx, monitor), {
    event: 'monitor.up',
    title: `${monitor.name} is back`,
    body: `Down for about ${downMinutes} minute${downMinutes === 1 ? '' : 's'}.`,
    link: `/support/monitors/${monitor._id}`,
  });
}

/** Whoever should hear: the project's team, and failing that everybody who keeps monitors. */
async function monitorWatchers(ctx: MutationCtx, monitor: Doc<'monitors'>): Promise<Id<'teamMembers'>[]> {
  const ids: Id<'teamMembers'>[] = [];
  if (monitor.projectId) {
    const project = await ctx.db.get('projects', monitor.projectId);
    if (project?.managerMemberId) ids.push(project.managerMemberId);
    const members = await ctx.db
      .query('projectMembers')
      .withIndex('by_project', (q) => q.eq('projectId', monitor.projectId!))
      .collect();
    ids.push(...members.map((row) => row.memberId));
  }
  return ids.length > 0 ? ids : await activeMembersWith(ctx, 'monitors.manage');
}

/** Checks older than the retention window. The month's figure lives on the SLA report, which is kept for good. */
export const forgetOldChecks = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ removed: number }> => {
    const cutoff = Date.now() - CHECK_RETENTION_MS;
    const old = await ctx.db.query('monitorChecks').take(2000);
    let removed = 0;
    for (const check of old) {
      if (check.checkedAt >= cutoff) continue;
      await ctx.db.delete('monitorChecks', check._id);
      removed++;
    }
    return { removed };
  },
});

/** Fetching every monitor that is due. One slow site must not hold up the rest, so they are checked together. */
export const runDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    const due = await ctx.runMutation(internal.monitors.due, {});
    await Promise.all(
      due.map(async (monitor) => {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), monitor.timeoutMs);
        try {
          const response = await fetch(monitor.url, {
            method: monitor.method,
            signal: controller.signal,
            redirect: 'follow',
          });
          await ctx.runMutation(internal.monitors.record, {
            monitorId: monitor.monitorId,
            ok: response.status === monitor.expectedStatus,
            statusCode: response.status,
            latencyMs: Date.now() - startedAt,
          });
        } catch (error) {
          await ctx.runMutation(internal.monitors.record, {
            monitorId: monitor.monitorId,
            ok: false,
            latencyMs: Date.now() - startedAt,
            // A timeout reads as a timeout rather than as whatever the runtime calls an aborted fetch.
            error: controller.signal.aborted ? 'timed out' : ((error as Error).message ?? 'could not be reached'),
          });
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    return { checked: due.length };
  },
});
