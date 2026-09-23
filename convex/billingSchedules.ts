import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { recordActivity, text } from './lib/crm';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { draftInvoice, invoiceError, studioToday } from './lib/invoices';
import { formatMoney } from './lib/money';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { assertAddsUp, itemAmountMinor, pendingItems, scheduleError, scheduledTotalMinor } from './lib/schedules';

// Billing schedules (08-billing-and-finance.md, Billing schedules). A fixed-price project's amount is split into items;
// each raises an invoice when its trigger fires: the contract being signed, a date arriving, or a milestone being
// approved. The invoice is a draft for Finance unless the schedule sends on its own.

const itemInput = v.object({
  label: v.string(),
  kind: v.union(v.literal('percent'), v.literal('fixed')),
  bps: v.optional(v.number()),
  amountMinor: v.optional(v.number()),
  trigger: v.union(v.literal('on_signature'), v.literal('on_date'), v.literal('on_milestone_approved')),
  date: v.optional(v.string()),
  milestoneId: v.optional(v.id('milestones')),
});

function scheduleView(schedule: Doc<'billingSchedules'>) {
  return {
    id: schedule._id,
    projectId: schedule.projectId,
    clientId: schedule.clientId,
    contractDocumentId: schedule.contractDocumentId,
    currency: schedule.currency,
    status: schedule.status,
    amountMinor: schedule.amountMinor,
    scheduledMinor: scheduledTotalMinor(schedule.items),
    autoSend: schedule.autoSend,
    items: schedule.items,
  };
}

export const forProject = teamQuery('invoices.view')({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const schedule = await ctx.db
      .query('billingSchedules')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .first();
    return schedule ? scheduleView(schedule) : null;
  },
});

async function buildItems(items: (typeof itemInput.type)[], amountMinor: number) {
  return items.map((item, index) => ({
    id: `i${index + 1}`,
    label: text(item.label, 'Label', { required: true, max: 200 })!,
    kind: item.kind,
    bps: item.bps,
    amountMinor: itemAmountMinor(item, amountMinor),
    trigger: item.trigger,
    date: item.date,
    milestoneId: item.milestoneId,
    status: 'pending' as const,
  }));
}

/** One schedule per project, built from the project's own amount. */
export const create = teamMutation('schedules.manage')({
  args: {
    projectId: v.id('projects'),
    contractDocumentId: v.optional(v.id('documents')),
    amountMinor: v.optional(v.number()),
    items: v.array(itemInput),
    autoSend: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get('projects', args.projectId);
    if (!project) throw scheduleError('schedules.notFound', 'Project not found');
    const existing = await ctx.db
      .query('billingSchedules')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
      .first();
    if (existing) throw scheduleError('schedules.exists', 'This project already has a billing schedule');
    const amountMinor = args.amountMinor ?? project.budgetMinor;
    if (!amountMinor) {
      throw scheduleError('schedules.noAmount', 'Give the project a budget, or say what the schedule covers');
    }
    return await ctx.db.insert('billingSchedules', {
      projectId: project._id,
      clientId: project.clientId,
      contractDocumentId: args.contractDocumentId,
      currency: project.currency,
      status: 'draft',
      amountMinor,
      items: await buildItems(args.items, amountMinor),
      autoSend: args.autoSend ?? false,
      createdByMemberId: ctx.principal.member._id,
    });
  },
});

async function getSchedule(ctx: MutationCtx, scheduleId: Id<'billingSchedules'>) {
  const schedule = await ctx.db.get('billingSchedules', scheduleId);
  if (!schedule) throw scheduleError('schedules.notFound', 'Schedule not found');
  return schedule;
}

/** Changing the plan, while it is still a draft; an active schedule is paused first. */
export const update = teamMutation('schedules.manage')({
  args: {
    scheduleId: v.id('billingSchedules'),
    amountMinor: v.optional(v.number()),
    items: v.optional(v.array(itemInput)),
    autoSend: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const schedule = await getSchedule(ctx, args.scheduleId);
    if (schedule.items.some((item) => item.status === 'invoiced')) {
      throw scheduleError('schedules.invoiced', 'Part of this schedule has been invoiced, so its items cannot change');
    }
    const amountMinor = args.amountMinor ?? schedule.amountMinor;
    await ctx.db.patch('billingSchedules', schedule._id, {
      amountMinor,
      items: args.items ? await buildItems(args.items, amountMinor) : schedule.items,
      autoSend: args.autoSend ?? schedule.autoSend,
    });
  },
});

/** Turns the schedule on, once its items add up to what the project is worth. */
export const activate = teamMutation('schedules.manage')({
  args: { scheduleId: v.id('billingSchedules') },
  handler: async (ctx, { scheduleId }) => {
    const schedule = await getSchedule(ctx, scheduleId);
    assertAddsUp(schedule.items, schedule.amountMinor, schedule.currency);
    await ctx.db.patch('billingSchedules', scheduleId, { status: 'active' });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: schedule.clientId },
      clientId: schedule.clientId,
      type: 'system',
      title: `Billing schedule activated: ${formatMoney(schedule.amountMinor, schedule.currency)} in ${schedule.items.length} parts`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { scheduleId, projectId: schedule.projectId },
    });
  },
});

export const pause = teamMutation('schedules.manage')({
  args: { scheduleId: v.id('billingSchedules') },
  handler: async (ctx, { scheduleId }) => {
    await getSchedule(ctx, scheduleId);
    await ctx.db.patch('billingSchedules', scheduleId, { status: 'draft' });
  },
});

/** Marks an item as never to be invoiced, with the rest left alone. */
export const skipItem = teamMutation('schedules.manage')({
  args: { scheduleId: v.id('billingSchedules'), itemId: v.string(), reason: v.string() },
  handler: async (ctx, { scheduleId, itemId, reason }) => {
    const schedule = await getSchedule(ctx, scheduleId);
    const item = schedule.items.find((row) => row.id === itemId);
    if (!item) throw scheduleError('schedules.notFound', 'That item is not on this schedule');
    if (item.status === 'invoiced') throw scheduleError('schedules.invoiced', 'That item has already been invoiced');
    await ctx.db.patch('billingSchedules', scheduleId, {
      items: schedule.items.map((row) => (row.id === itemId ? { ...row, status: 'skipped' as const } : row)),
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: schedule.clientId },
      clientId: schedule.clientId,
      type: 'system',
      title: `${item.label} will not be invoiced`,
      body: text(reason, 'Reason', { required: true, max: 500 }),
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { scheduleId, projectId: schedule.projectId },
    });
  },
});

/** Raises the invoice for one item and marks it invoiced. Sends it when the schedule says so. */
async function invoiceItem(ctx: MutationCtx, schedule: Doc<'billingSchedules'>, itemId: string) {
  const item = schedule.items.find((row) => row.id === itemId);
  if (!item || item.status !== 'pending') return null;
  const project = await ctx.db.get('projects', schedule.projectId);
  const invoiceId = await draftInvoice(ctx, {
    clientId: schedule.clientId,
    projectId: schedule.projectId,
    contractDocumentId: schedule.contractDocumentId,
    type: item.trigger === 'on_signature' ? 'deposit' : 'milestone',
    currency: schedule.currency,
    lineItems: [
      {
        description: project ? `${project.name}: ${item.label}` : item.label,
        quantityMilli: 1_000,
        unitPriceMinor: item.amountMinor,
        amountMinor: item.amountMinor,
        taxable: true,
      },
    ],
    createdByMemberId: schedule.createdByMemberId,
  });
  await ctx.db.patch('billingSchedules', schedule._id, {
    items: schedule.items.map((row) =>
      row.id === itemId ? { ...row, status: 'invoiced' as const, invoiceId, invoicedAt: Date.now() } : row,
    ),
  });
  if (schedule.autoSend) {
    await ctx.scheduler.runAfter(0, internal.invoiceSending.send, {
      invoiceId,
      memberId: schedule.createdByMemberId,
    });
  } else {
    await notifyTeamMembers(ctx, await activeMembersWith(ctx, 'invoices.send'), {
      event: 'invoice_ready_to_send',
      title: `${item.label} is ready to invoice`,
      body: `${formatMoney(item.amountMinor, schedule.currency)} drafted from ${project?.name ?? 'the'} billing schedule.`,
      link: `/billing/invoices/${invoiceId}`,
    });
  }
  return invoiceId;
}

/** The contract was signed: everything waiting on the signature is invoiced. */
export const onDocumentSigned = internalMutation({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }): Promise<null> => {
    const document = await ctx.db.get('documents', documentId);
    if (!document) return null;
    const schedules = [
      ...(await ctx.db
        .query('billingSchedules')
        .withIndex('by_contract', (q) => q.eq('contractDocumentId', documentId))
        .collect()),
      ...(document.projectId
        ? await ctx.db
            .query('billingSchedules')
            .withIndex('by_project', (q) => q.eq('projectId', document.projectId!))
            .collect()
        : []),
    ];
    const seen = new Set<string>();
    for (const schedule of schedules) {
      if (seen.has(schedule._id) || schedule.status !== 'active') continue;
      seen.add(schedule._id);
      for (const item of pendingItems(schedule, 'on_signature')) {
        await invoiceItem(ctx, (await ctx.db.get('billingSchedules', schedule._id))!, item.id);
      }
    }
    return null;
  },
});

/** A milestone was approved: the item waiting on it is invoiced. */
export const onMilestoneApproved = internalMutation({
  args: { milestoneId: v.id('milestones') },
  handler: async (ctx, { milestoneId }): Promise<null> => {
    const milestone = await ctx.db.get('milestones', milestoneId);
    if (!milestone) return null;
    const schedules = await ctx.db
      .query('billingSchedules')
      .withIndex('by_project', (q) => q.eq('projectId', milestone.projectId))
      .collect();
    for (const schedule of schedules.filter((row) => row.status === 'active')) {
      for (const item of pendingItems(schedule, 'on_milestone_approved')) {
        // An item with no milestone named waits for the last one, so an approval only fires it when it is that one.
        if (item.milestoneId && item.milestoneId !== milestoneId) continue;
        if (!item.milestoneId && !(await isLastMilestone(ctx, milestone.projectId))) continue;
        const invoiceId = await invoiceItem(ctx, (await ctx.db.get('billingSchedules', schedule._id))!, item.id);
        if (invoiceId) await ctx.db.patch('milestones', milestoneId, { status: 'invoiced' });
      }
    }
    return null;
  },
});

async function isLastMilestone(ctx: MutationCtx, projectId: Id<'projects'>) {
  const milestones = await ctx.db
    .query('milestones')
    .withIndex('by_project_order', (q) => q.eq('projectId', projectId))
    .collect();
  return milestones.every((milestone) => ['approved', 'invoiced', 'skipped'].includes(milestone.status));
}

/** Daily: items whose date has come are invoiced. */
export const invoiceDueItems = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ invoiced: number }> => {
    const today = await studioToday(ctx);
    const schedules = await ctx.db
      .query('billingSchedules')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect();
    let invoiced = 0;
    for (const schedule of schedules) {
      for (const item of pendingItems(schedule, 'on_date')) {
        if (!item.date || item.date > today) continue;
        const current = await ctx.db.get('billingSchedules', schedule._id);
        if (current && (await invoiceItem(ctx, current, item.id))) invoiced++;
      }
    }
    return { invoiced };
  },
});

/** Raises an item's invoice now, whatever its trigger says. */
export const invoiceNow = teamMutation('schedules.manage')({
  args: { scheduleId: v.id('billingSchedules'), itemId: v.string() },
  handler: async (ctx, { scheduleId, itemId }) => {
    const schedule = await getSchedule(ctx, scheduleId);
    if (schedule.status !== 'active') throw scheduleError('schedules.notActive', 'Activate the schedule first');
    const invoiceId = await invoiceItem(ctx, schedule, itemId);
    if (!invoiceId) throw invoiceError('invoices.invalid', 'That item cannot be invoiced');
    return invoiceId;
  },
});
