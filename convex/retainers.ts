import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { recordActivity } from './lib/crm';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { draftInvoice, studioToday } from './lib/invoices';
import { formatMoney, mulDivRoundHalfUp } from './lib/money';
import { clientPortalContacts, notifyClientContacts, notifyTeamMembers } from './lib/notify';
import { notFound, visibleProject } from './lib/projects';
import {
  assertRetainerTerms,
  firstPeriod,
  hoursFrom,
  periodFrom,
  retainerError,
  splitUsage,
  usageBps,
} from './lib/retainers';

// Retainers (08-billing-and-finance.md, Retainers). A monthly fee for a number of included minutes, billed a period in
// advance. On the invoice day the period that has ended is closed, the next one opens and is invoiced, and any overage
// on the closed period is invoiced at the overage rate — overage can only be known after the fact.

const MINUTES_PER_HOUR = 60;

async function getRetainer(ctx: QueryCtx | MutationCtx, retainerId: Id<'retainers'>) {
  const retainer = await ctx.db.get('retainers', retainerId);
  if (!retainer) throw notFound('Retainer');
  return retainer;
}

/** The period a retainer is in now: the one still open. */
async function openPeriod(ctx: QueryCtx | MutationCtx, retainerId: Id<'retainers'>) {
  return await ctx.db
    .query('retainerPeriods')
    .withIndex('by_open', (q) => q.eq('retainerId', retainerId).eq('closedAt', undefined))
    .first();
}

/** Minutes approved against the retainer's project inside the period (09-support-and-sla.md, Retainer hours). */
async function usedMinutesIn(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<'projects'>,
  period: { periodStart: string; periodEnd: string },
) {
  const entries = await ctx.db
    .query('timeEntries')
    .withIndex('by_project_date', (q) =>
      q.eq('projectId', projectId).gte('date', period.periodStart).lte('date', period.periodEnd),
    )
    .collect();
  return entries
    .filter((entry) => entry.status === 'approved' || entry.status === 'invoiced')
    .reduce((sum, entry) => sum + entry.minutes, 0);
}

function periodView(period: Doc<'retainerPeriods'>) {
  const split = splitUsage(period);
  return {
    id: period._id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    includedMinutes: period.includedMinutes,
    rolloverMinutes: period.rolloverMinutes,
    usedMinutes: period.usedMinutes,
    remainingMinutes: split.remainingMinutes,
    overageMinutes: split.overageMinutes,
    usageBps: usageBps(period),
    invoiceId: period.invoiceId,
    overageInvoiceId: period.overageInvoiceId,
    closedAt: period.closedAt,
  };
}

function retainerView(retainer: Doc<'retainers'>) {
  return {
    id: retainer._id,
    clientId: retainer.clientId,
    projectId: retainer.projectId,
    currency: retainer.currency,
    monthlyFeeMinor: retainer.monthlyFeeMinor,
    includedMinutes: retainer.includedMinutes,
    overageRateMinor: retainer.overageRateMinor,
    invoiceDayOfMonth: retainer.invoiceDayOfMonth,
    startDate: retainer.startDate,
    endDate: retainer.endDate,
    status: retainer.status,
    autoSend: retainer.autoSend,
    rolloverUnusedMinutes: retainer.rolloverUnusedMinutes,
  };
}

/** The retainer on a project, with where the current period stands and the ones before it. */
export const forProject = teamQuery(null)({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await visibleProject(ctx, ctx.principal, projectId);
    const retainer = await ctx.db
      .query('retainers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .first();
    if (!retainer) return null;
    const periods = await ctx.db
      .query('retainerPeriods')
      .withIndex('by_retainer_start', (q) => q.eq('retainerId', retainer._id))
      .collect();
    const current = periods.find((period) => !period.closedAt);
    return {
      ...retainerView(retainer),
      // Live, so the hours left are right the moment someone looks rather than at the last cron run.
      current: current
        ? periodView({ ...current, usedMinutes: await usedMinutesIn(ctx, retainer.projectId, current) })
        : null,
      past: periods
        .filter((period) => period.closedAt)
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
        .map(periodView),
    };
  },
});

const terms = {
  monthlyFeeMinor: v.number(),
  includedMinutes: v.number(),
  overageRateMinor: v.number(),
  invoiceDayOfMonth: v.number(),
  autoSend: v.optional(v.boolean()),
  rolloverUnusedMinutes: v.optional(v.boolean()),
  slaPolicyId: v.optional(v.id('slaPolicies')),
};

/** Starts a retainer and opens its first period; the first invoice goes out on the next invoice day. */
export const create = teamMutation('retainers.manage')({
  args: { projectId: v.id('projects'), startDate: v.string(), ...terms },
  handler: async (ctx, args) => {
    const project = await ctx.db.get('projects', args.projectId);
    if (!project) throw notFound('Project');
    const existing = await ctx.db
      .query('retainers')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
      .first();
    if (existing && existing.status !== 'ended') {
      throw retainerError('retainers.exists', 'This project already has a retainer');
    }
    assertRetainerTerms(args);
    const retainerId = await ctx.db.insert('retainers', {
      clientId: project.clientId,
      projectId: project._id,
      slaPolicyId: args.slaPolicyId,
      currency: project.currency,
      monthlyFeeMinor: args.monthlyFeeMinor,
      includedMinutes: args.includedMinutes,
      overageRateMinor: args.overageRateMinor,
      invoiceDayOfMonth: args.invoiceDayOfMonth,
      startDate: args.startDate,
      status: 'active',
      autoSend: args.autoSend ?? false,
      rolloverUnusedMinutes: args.rolloverUnusedMinutes ?? false,
      createdByMemberId: ctx.principal.member._id,
    });
    await ctx.db.insert('retainerPeriods', {
      retainerId,
      ...firstPeriod(args.startDate, args.invoiceDayOfMonth),
      includedMinutes: args.includedMinutes,
      rolloverMinutes: 0,
      usedMinutes: 0,
    });
    return retainerId;
  },
});

/** Changing the terms, which apply from the next period; the open period keeps what it was sold on. */
export const update = teamMutation('retainers.manage')({
  args: { retainerId: v.id('retainers'), ...terms },
  handler: async (ctx, { retainerId, ...args }) => {
    const retainer = await getRetainer(ctx, retainerId);
    if (retainer.status === 'ended') throw retainerError('retainers.ended', 'This retainer has ended');
    assertRetainerTerms(args);
    await ctx.db.patch('retainers', retainerId, {
      monthlyFeeMinor: args.monthlyFeeMinor,
      includedMinutes: args.includedMinutes,
      overageRateMinor: args.overageRateMinor,
      invoiceDayOfMonth: args.invoiceDayOfMonth,
      slaPolicyId: args.slaPolicyId,
      autoSend: args.autoSend ?? retainer.autoSend,
      rolloverUnusedMinutes: args.rolloverUnusedMinutes ?? retainer.rolloverUnusedMinutes,
    });
  },
});

/** Paused retainers are not invoiced; the open period stays as it is until they start again. */
export const setStatus = teamMutation('retainers.manage')({
  args: {
    retainerId: v.id('retainers'),
    status: v.union(v.literal('active'), v.literal('paused'), v.literal('ended')),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, { retainerId, status, endDate }) => {
    const retainer = await getRetainer(ctx, retainerId);
    await ctx.db.patch('retainers', retainerId, {
      status,
      endDate: status === 'ended' ? (endDate ?? (await studioToday(ctx))) : retainer.endDate,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: retainer.clientId },
      clientId: retainer.clientId,
      type: 'system',
      title: `Retainer ${status === 'active' ? 'resumed' : status}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { retainerId, projectId: retainer.projectId },
    });
  },
});

/** The fee for the coming period, and the overage for the one that has just closed. */
async function billPeriods(
  ctx: MutationCtx,
  retainer: Doc<'retainers'>,
  closing: Doc<'retainerPeriods'>,
  opening: { periodStart: string; periodEnd: string; includedMinutes: number; rolloverMinutes: number },
) {
  const feeInvoiceId = await draftInvoice(ctx, {
    clientId: retainer.clientId,
    projectId: retainer.projectId,
    type: 'retainer',
    currency: retainer.currency,
    lineItems: [
      {
        description: `Retainer, ${opening.periodStart} to ${opening.periodEnd} (${hoursFrom(opening.includedMinutes)} hours included)`,
        quantityMilli: 1_000,
        unitPriceMinor: retainer.monthlyFeeMinor,
        amountMinor: retainer.monthlyFeeMinor,
        taxable: true,
      },
    ],
    createdByMemberId: retainer.createdByMemberId,
  });

  const { overageMinutes } = splitUsage(closing);
  let overageInvoiceId: Id<'invoices'> | null = null;
  if (overageMinutes > 0 && retainer.overageRateMinor > 0) {
    // The rate is per hour; the minutes are billed in the proportion they were used.
    const amountMinor = mulDivRoundHalfUp(retainer.overageRateMinor, overageMinutes, MINUTES_PER_HOUR);
    overageInvoiceId = await draftInvoice(ctx, {
      clientId: retainer.clientId,
      projectId: retainer.projectId,
      type: 'time_and_materials',
      currency: retainer.currency,
      lineItems: [
        {
          description: `Retainer overage, ${closing.periodStart} to ${closing.periodEnd}: ${hoursFrom(overageMinutes)} hours beyond the included time`,
          quantityMilli: Math.round((overageMinutes / MINUTES_PER_HOUR) * 1_000),
          unitPriceMinor: retainer.overageRateMinor,
          amountMinor,
          taxable: true,
        },
      ],
      createdByMemberId: retainer.createdByMemberId,
    });
  }

  for (const invoiceId of [feeInvoiceId, overageInvoiceId]) {
    if (!invoiceId) continue;
    if (retainer.autoSend) {
      await ctx.scheduler.runAfter(0, internal.invoiceSending.send, {
        invoiceId,
        memberId: retainer.createdByMemberId,
      });
    } else {
      await notifyTeamMembers(ctx, [retainer.createdByMemberId], {
        event: 'invoice_ready_to_send',
        title: `A retainer invoice is ready to send`,
        body: `${formatMoney(retainer.monthlyFeeMinor, retainer.currency)} for ${opening.periodStart} to ${opening.periodEnd}.`,
        link: `/billing/invoices/${invoiceId}`,
      });
    }
  }
  return { feeInvoiceId, overageInvoiceId };
}

/** Rolls one retainer on: closes the period that ended, opens and invoices the next. */
async function rollOver(ctx: MutationCtx, retainer: Doc<'retainers'>, today: string): Promise<boolean> {
  const closing = await openPeriod(ctx, retainer._id);
  if (!closing || today <= closing.periodEnd) return false;

  const usedMinutes = await usedMinutesIn(ctx, retainer.projectId, closing);
  const closed = { ...closing, usedMinutes };
  const { rollsOverMinutes } = splitUsage(closed);
  const next = periodFrom(
    new Date(Date.parse(`${closing.periodEnd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    retainer.invoiceDayOfMonth,
  );
  const opening = {
    ...next,
    includedMinutes: retainer.includedMinutes,
    rolloverMinutes: retainer.rolloverUnusedMinutes ? rollsOverMinutes : 0,
  };

  const { feeInvoiceId, overageInvoiceId } = await billPeriods(ctx, retainer, closed, opening);
  await ctx.db.patch('retainerPeriods', closing._id, {
    usedMinutes,
    closedAt: Date.now(),
    overageInvoiceId: overageInvoiceId ?? undefined,
  });
  await ctx.db.insert('retainerPeriods', {
    retainerId: retainer._id,
    ...opening,
    usedMinutes: 0,
    invoiceId: feeInvoiceId,
  });
  return true;
}

/** Tells the studio and the client when a period is running out (08-billing-and-finance.md, Retainers). */
async function sendUsageAlerts(ctx: MutationCtx, retainer: Doc<'retainers'>) {
  const period = await openPeriod(ctx, retainer._id);
  if (!period) return;
  const usedMinutes = await usedMinutesIn(ctx, retainer.projectId, period);
  const bps = usageBps({ ...period, usedMinutes });
  const at100 = bps >= 10_000 && !period.alert100SentAt;
  const at80 = bps >= 8_000 && !period.alert80SentAt && !at100;
  if (!at80 && !at100) return;

  const project = await ctx.db.get('projects', retainer.projectId);
  const allowed = period.includedMinutes + period.rolloverMinutes;
  const title = at100
    ? `${project?.name ?? 'The retainer'}: the included hours for this period are used up`
    : `${project?.name ?? 'The retainer'}: 80% of this period's hours are used`;
  const body = `${hoursFrom(usedMinutes)} of ${hoursFrom(allowed)} hours used, to ${period.periodEnd}.${
    at100 ? ' Anything further is billed at the overage rate.' : ''
  }`;
  if (project?.managerMemberId) {
    await notifyTeamMembers(ctx, [project.managerMemberId], {
      event: at100 ? 'retainer_hours_used' : 'retainer_hours_80',
      title,
      body,
      link: `/projects/${retainer.projectId}`,
    });
  }
  await notifyClientContacts(ctx, await clientPortalContacts(ctx, retainer.clientId), {
    event: at100 ? 'retainer_hours_used' : 'retainer_hours_80',
    title,
    body,
    link: `/projects/${retainer.projectId}`,
  });
  await ctx.db.patch('retainerPeriods', period._id, {
    usedMinutes,
    ...(at100 ? { alert100SentAt: Date.now(), alert80SentAt: period.alert80SentAt ?? Date.now() } : {}),
    ...(at80 ? { alert80SentAt: Date.now() } : {}),
  });
}

/** Daily: rolls on every retainer whose period has ended, and sends the usage alerts. */
export const runDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ rolled: number }> => {
    const today = await studioToday(ctx);
    const retainers = await ctx.db
      .query('retainers')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect();
    let rolled = 0;
    for (const retainer of retainers) {
      // Ended in the meantime: the last period still closes, but nothing new opens.
      if (retainer.endDate && retainer.endDate < today) continue;
      if (await rollOver(ctx, retainer, today)) rolled++;
      await sendUsageAlerts(ctx, retainer);
    }
    return { rolled };
  },
});
