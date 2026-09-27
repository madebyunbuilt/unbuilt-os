import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { recordActivity, requirePermission, text } from './lib/crm';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { studioToday } from './lib/invoices';
import { activeMembersWith, clientPortalContacts, notifyClientContacts, notifyTeamMembers } from './lib/notify';
import { figuresFor, monitoringFor, previousMonth, retainerMinutesFor } from './lib/slaReports';
import { slaError } from './lib/sla';

// The monthly SLA report (09-support-and-sla.md). Generated when the month closes, read and sent by a person: a
// report that went out on its own would eventually tell a client something nobody at the studio had looked at.

function view(report: Doc<'slaReports'>) {
  return {
    id: report._id,
    clientId: report.clientId,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    status: report.status,
    byPriority: report.byPriority,
    breaches: report.breaches,
    retainerMinutes: report.retainerMinutes,
    monitoring: report.monitoring,
    uptime: report.uptime ?? [],
    incidents: report.incidents ?? [],
    generatedAt: report.generatedAt,
    sentAt: report.sentAt,
  };
}

/**
 * Writes one client's report for a closed month. Says whether it wrote one, rather than leaving the caller to work it
 * out from a timestamp: running the month twice must not announce the same report again.
 */
export async function generateFor(
  ctx: MutationCtx,
  args: { clientId: Id<'clients'>; periodStart: string; periodEnd: string },
): Promise<{ reportId: Id<'slaReports'>; created: boolean } | null> {
  const client = await ctx.db.get('clients', args.clientId);
  if (!client?.slaPolicyId) return null;
  const policy = await ctx.db.get('slaPolicies', client.slaPolicyId);
  if (!policy) return null;

  const existing = await ctx.db
    .query('slaReports')
    .withIndex('by_client_period', (q) => q.eq('clientId', args.clientId).eq('periodStart', args.periodStart))
    .first();
  // Written once. Running the cron twice, or catching up by hand, must not hand a client a second version.
  if (existing) return { reportId: existing._id, created: false };

  const figures = await figuresFor(ctx, { ...args, policy });
  const watched = await monitoringFor(ctx, { ...args, targetBps: policy.uptimeTargetBps });
  const monitoring = watched.monitored
    ? { uptime: watched.uptime, incidents: watched.incidents }
    : // Said outright, so an empty section cannot read as though nothing went wrong.
      { monitoring: 'not_monitored' as const };
  const reportId = await ctx.db.insert('slaReports', {
    clientId: args.clientId,
    slaPolicyId: policy._id,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    status: 'draft',
    generatedAt: Date.now(),
    ...figures,
    retainerMinutes: await retainerMinutesFor(ctx, args),
    ...monitoring,
  });
  return { reportId, created: true };
}

/**
 * The month's reports, one per client with an SLA policy. Run on the first business day of the month so the studio
 * finds them waiting rather than having to ask for them.
 */
export const generateMonthly = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ generated: number }> => {
    const { periodStart, periodEnd } = previousMonth(await studioToday(ctx));
    const clients = (await ctx.db.query('clients').take(2000)).filter(
      (client) => client.slaPolicyId && client.status !== 'archived',
    );

    let generated = 0;
    const managers = await activeMembersWith(ctx, 'sla.manage');
    for (const client of clients) {
      const written = await generateFor(ctx, { clientId: client._id, periodStart, periodEnd });
      // Only a report written just now is worth announcing; one that already existed has been waiting all along.
      if (!written?.created) continue;
      const report = await ctx.db.get('slaReports', written.reportId);
      if (!report) continue;
      generated++;
      await notifyTeamMembers(ctx, managers, {
        event: 'sla.report.ready',
        title: `${client.displayName}: last month's SLA report is ready`,
        body: `${report.breaches.length} missed target${report.breaches.length === 1 ? '' : 's'}. Read it before it goes out.`,
        link: `/support/reports/${written.reportId}`,
      });
    }
    return { generated };
  },
});

/** Reports still sitting unread after three business days, which is long enough for a client to wonder. */
export const remindUnsent = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ reminded: number }> => {
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const drafts = await ctx.db
      .query('slaReports')
      .withIndex('by_status', (q) => q.eq('status', 'draft'))
      .collect();

    let reminded = 0;
    for (const report of drafts) {
      if (now - report.generatedAt < threeDays) continue;
      if (report.remindedAt !== undefined) continue;
      const client = await ctx.db.get('clients', report.clientId);
      await notifyTeamMembers(ctx, await activeMembersWith(ctx, 'sla.manage'), {
        event: 'sla.report.unsent',
        title: `${client?.displayName ?? 'A client'} is still waiting for last month's report`,
        body: `Generated ${new Date(report.generatedAt).toISOString().slice(0, 10)} and not sent yet.`,
        link: `/support/reports/${report._id}`,
      });
      await ctx.db.patch('slaReports', report._id, { remindedAt: now });
      reminded++;
    }
    return { reminded };
  },
});

export const list = teamQuery(null)({
  args: { clientId: v.optional(v.id('clients')), status: v.optional(v.union(v.literal('draft'), v.literal('sent'))) },
  handler: async (ctx, { clientId, status }) => {
    requirePermission(ctx.principal, 'sla.manage');
    const rows = clientId
      ? await ctx.db
          .query('slaReports')
          .withIndex('by_client_period', (q) => q.eq('clientId', clientId))
          .collect()
      : await ctx.db.query('slaReports').take(500);
    const wanted = rows.filter((report) => !status || report.status === status);
    return await Promise.all(
      wanted
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
        .map(async (report) => ({
          ...view(report),
          clientName: (await ctx.db.get('clients', report.clientId))?.displayName ?? 'Unknown client',
        })),
    );
  },
});

export const get = teamQuery(null)({
  args: { reportId: v.id('slaReports') },
  handler: async (ctx, { reportId }) => {
    requirePermission(ctx.principal, 'sla.manage');
    const report = await ctx.db.get('slaReports', reportId);
    if (!report) return null;
    const client = await ctx.db.get('clients', report.clientId);
    const policy = await ctx.db.get('slaPolicies', report.slaPolicyId);
    return {
      ...view(report),
      clientName: client?.displayName ?? 'Unknown client',
      policyName: policy?.name,
    };
  },
});

/**
 * Sending it. The figures are already fixed; this records that a person read them and decided the client should see
 * them, and puts the report in the portal.
 */
export const send = teamMutation('sla.manage')({
  args: { reportId: v.id('slaReports') },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get('slaReports', reportId);
    if (!report) throw slaError('sla.notFound', 'That report is not here');
    if (report.status === 'sent') throw slaError('sla.alreadySent', 'This report has already gone to the client');

    const now = Date.now();
    await ctx.db.patch('slaReports', reportId, {
      status: 'sent',
      sentAt: now,
      sentByMemberId: ctx.principal.member._id,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: report.clientId },
      clientId: report.clientId,
      type: 'system',
      title: `SLA report for ${report.periodStart.slice(0, 7)} sent by ${ctx.principal.member.name}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      occurredAt: now,
    });
    await notifyClientContacts(ctx, await clientPortalContacts(ctx, report.clientId), {
      event: 'sla.report.sent',
      title: `Your support report for ${report.periodStart.slice(0, 7)}`,
      body: 'How Unbuilt did against what it promised last month.',
      link: `/reports/${reportId}`,
    });
  },
});

/** Why a target was missed, which only a person can say, and which the client reads in the monthly report. */
export const setBreachReason = teamMutation('tickets.manage')({
  args: { ticketId: v.id('tickets'), reason: v.string() },
  handler: async (ctx, { ticketId, reason }) => {
    const ticket = await ctx.db.get('tickets', ticketId);
    if (!ticket) throw slaError('tickets.notFound', 'Ticket not found');
    await ctx.db.patch('tickets', ticketId, {
      breachReason: text(reason, 'Reason', { max: 500 }),
    });
  },
});

/** Generating a month by hand, for a client whose report was missed or whose policy arrived late. */
export const generate = teamMutation('sla.manage')({
  args: { clientId: v.id('clients'), periodStart: v.string() },
  handler: async (ctx, { clientId, periodStart }) => {
    if (!/^\d{4}-\d{2}-01$/.test(periodStart)) {
      throw slaError('sla.invalid', 'A report covers a whole month, so it starts on the first');
    }
    const [year, month] = periodStart.split('-').map(Number);
    const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (periodEnd >= (await studioToday(ctx))) {
      throw slaError('sla.invalid', 'That month has not finished yet');
    }
    const written = await generateFor(ctx, { clientId, periodStart, periodEnd });
    if (!written) throw slaError('sla.invalid', 'That client has no SLA policy, so there is nothing to report on');
    return written;
  },
});
