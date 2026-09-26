import { v } from 'convex/values';
import { type Doc } from './_generated/dataModel';
import { portalQuery } from './lib/functions';
import { type ClientPrincipal } from './lib/principals';

// SLA reports as the client reads them (12-client-portal.md, Support). Only what the studio has sent: a draft is the
// studio's own working paper, and a month nobody has looked at is not yet a statement about anything.

function view(report: Doc<'slaReports'>) {
  return {
    id: report._id,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    byPriority: report.byPriority,
    breaches: report.breaches.map((breach) => ({
      number: breach.number,
      subject: breach.subject,
      priority: breach.priority,
      target: breach.target,
      lateMinutes: breach.lateMinutes,
      reason: breach.reason,
    })),
    retainerMinutes: report.retainerMinutes,
    monitoring: report.monitoring,
    sentAt: report.sentAt,
  };
}

export const list = portalQuery('portal.reports.view')({
  args: {},
  handler: async (ctx) => {
    const principal = ctx.principal as ClientPrincipal;
    const reports = await ctx.db
      .query('slaReports')
      .withIndex('by_client_period', (q) => q.eq('clientId', principal.clientId))
      .collect();
    return reports
      .filter((report) => report.status === 'sent')
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
      .map((report) => ({
        id: report._id,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        breaches: report.breaches.length,
        sentAt: report.sentAt,
      }));
  },
});

export const get = portalQuery('portal.reports.view')({
  args: { reportId: v.id('slaReports') },
  handler: async (ctx, { reportId }) => {
    const principal = ctx.principal as ClientPrincipal;
    const report = await ctx.db.get('slaReports', reportId);
    // Another client's report, or one the studio has not sent, is simply not there.
    if (!report || report.clientId !== principal.clientId || report.status !== 'sent') return null;
    return view(report);
  },
});
