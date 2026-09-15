import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { text } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { assertOpen, notFound, projectError, visibleProject } from './lib/projects';
import { isIsoDate } from './lib/validation';

// Milestones (06-projects.md, Milestones and deliverables). The team plans them and marks them in progress or skipped;
// approval comes from the client approving every deliverable in the portal, and invoicing from billing.

type Status = Doc<'milestones'>['status'];

function checkedDate(value: string | undefined) {
  if (!value) return undefined;
  if (!isIsoDate(value)) throw projectError('projects.invalid', 'Choose a due date');
  return value;
}

function checkedBilling(amountMinor: number | undefined, percentBps: number | undefined) {
  if (amountMinor !== undefined && percentBps !== undefined) {
    throw projectError('projects.invalid', 'Use a billing amount or a percentage, not both');
  }
  if (amountMinor !== undefined && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) {
    throw projectError('projects.invalid', 'The billing amount must be a whole, non-negative amount in minor units');
  }
  if (percentBps !== undefined && (!Number.isInteger(percentBps) || percentBps < 0 || percentBps > 10_000)) {
    throw projectError('projects.invalid', 'The billing percentage must be between 0% and 100%');
  }
  return { billingAmountMinor: amountMinor, billingPercentBps: percentBps };
}

async function getMilestone(ctx: MutationCtx, milestoneId: Id<'milestones'>) {
  const milestone = await ctx.db.get('milestones', milestoneId);
  if (!milestone) throw notFound('Milestone');
  return milestone;
}

async function projectMilestones(ctx: MutationCtx, projectId: Id<'projects'>) {
  return await ctx.db
    .query('milestones')
    .withIndex('by_project_order', (q) => q.eq('projectId', projectId))
    .collect();
}

/** Milestones in order, each with its deliverables. */
export const listForProject = teamQuery(null)({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await visibleProject(ctx, ctx.principal, projectId);
    const [milestones, deliverables] = await Promise.all([
      ctx.db
        .query('milestones')
        .withIndex('by_project_order', (q) => q.eq('projectId', projectId))
        .collect(),
      ctx.db
        .query('deliverables')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect(),
    ]);
    const view = (deliverable: Doc<'deliverables'>) => ({
      id: deliverable._id,
      title: deliverable.title,
      status: deliverable.status,
      currentVersion: deliverable.currentVersion,
      approvedVersion: deliverable.approvedVersion,
    });
    return {
      milestones: milestones.map((milestone) => ({
        id: milestone._id,
        name: milestone.name,
        order: milestone.order,
        dueDate: milestone.dueDate,
        status: milestone.status,
        billingAmountMinor: milestone.billingAmountMinor,
        billingPercentBps: milestone.billingPercentBps,
        approvedAt: milestone.approvedAt,
        deliverables: deliverables.filter((d) => d.milestoneId === milestone._id).map(view),
      })),
      unassigned: deliverables.filter((d) => !d.milestoneId).map(view),
    };
  },
});

const fields = {
  name: v.string(),
  dueDate: v.optional(v.string()),
  billingAmountMinor: v.optional(v.number()),
  billingPercentBps: v.optional(v.number()),
};

export const create = teamMutation('projects.update')({
  args: { projectId: v.id('projects'), ...fields },
  handler: async (ctx, { projectId, ...args }) => {
    const project = await visibleProject(ctx, ctx.principal, projectId);
    assertOpen(project);
    const existing = await projectMilestones(ctx, projectId);
    return await ctx.db.insert('milestones', {
      projectId,
      name: text(args.name, 'Name', { required: true, max: 120 })!,
      order: existing.length,
      dueDate: checkedDate(args.dueDate),
      status: 'upcoming',
      ...checkedBilling(args.billingAmountMinor, args.billingPercentBps),
    });
  },
});

export const update = teamMutation('projects.update')({
  args: { milestoneId: v.id('milestones'), ...fields },
  handler: async (ctx, { milestoneId, ...args }) => {
    const milestone = await getMilestone(ctx, milestoneId);
    assertOpen(await visibleProject(ctx, ctx.principal, milestone.projectId));
    if (milestone.status === 'invoiced') throw projectError('projects.locked', 'An invoiced milestone cannot change');
    await ctx.db.patch('milestones', milestoneId, {
      name: text(args.name, 'Name', { required: true, max: 120 })!,
      dueDate: checkedDate(args.dueDate),
      ...checkedBilling(args.billingAmountMinor, args.billingPercentBps),
    });
  },
});

export const reorder = teamMutation('projects.update')({
  args: { projectId: v.id('projects'), milestoneIds: v.array(v.id('milestones')) },
  handler: async (ctx, { projectId, milestoneIds }) => {
    assertOpen(await visibleProject(ctx, ctx.principal, projectId));
    const existing = await projectMilestones(ctx, projectId);
    if (milestoneIds.length !== existing.length || existing.some((m) => !milestoneIds.includes(m._id))) {
      throw projectError('projects.invalid', 'List every milestone exactly once');
    }
    for (const [order, id] of milestoneIds.entries()) await ctx.db.patch('milestones', id, { order });
  },
});

/** Statuses the team sets by hand. Approval comes from the client; invoiced comes from billing. */
const MANUAL: Status[] = ['upcoming', 'in_progress', 'skipped'];

export const setStatus = teamMutation('projects.update')({
  args: {
    milestoneId: v.id('milestones'),
    status: v.union(v.literal('upcoming'), v.literal('in_progress'), v.literal('skipped')),
  },
  handler: async (ctx, { milestoneId, status }) => {
    const milestone = await getMilestone(ctx, milestoneId);
    assertOpen(await visibleProject(ctx, ctx.principal, milestone.projectId));
    if (!MANUAL.includes(milestone.status) && milestone.status !== 'awaiting_approval') {
      throw projectError('projects.locked', `An ${milestone.status} milestone cannot change status by hand`);
    }
    await ctx.db.patch('milestones', milestoneId, { status });
  },
});

/** Deletes a milestone that is not approved or invoiced. Its deliverables and tasks stay, without a milestone. */
export const remove = teamMutation('projects.update')({
  args: { milestoneId: v.id('milestones') },
  handler: async (ctx, { milestoneId }) => {
    const milestone = await getMilestone(ctx, milestoneId);
    assertOpen(await visibleProject(ctx, ctx.principal, milestone.projectId));
    if (milestone.status === 'approved' || milestone.status === 'invoiced') {
      throw projectError('projects.locked', 'Approved and invoiced milestones stay on record');
    }
    for (const deliverable of await ctx.db
      .query('deliverables')
      .withIndex('by_milestone', (q) => q.eq('milestoneId', milestoneId))
      .collect()) {
      await ctx.db.patch('deliverables', deliverable._id, { milestoneId: undefined });
    }
    for (const task of await ctx.db
      .query('tasks')
      .withIndex('by_milestone', (q) => q.eq('milestoneId', milestoneId))
      .collect()) {
      await ctx.db.patch('tasks', task._id, { milestoneId: undefined });
    }
    await ctx.db.delete('milestones', milestoneId);
    const rest = await projectMilestones(ctx, milestone.projectId);
    for (const [order, row] of rest.entries())
      if (row.order !== order) await ctx.db.patch('milestones', row._id, { order });
  },
});
