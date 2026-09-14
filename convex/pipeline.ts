import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { crmError, text } from './lib/crm';
import { orderedStages } from './lib/deals';
import { teamMutation, teamQuery } from './lib/functions';

// Pipeline stages and lost reasons (05-crm.md, Pipeline and deals). Project managers shape the pipeline they run, so
// changes need deals.manage (decided by the studio on 2026-09-14). There is always exactly one Won and one Lost stage,
// after the open stages; only open stages are added, reordered or removed.

function stageView(stage: Doc<'pipelineStages'>, dealCount: number) {
  return {
    id: stage._id,
    name: stage.name,
    order: stage.order,
    probabilityBps: stage.probabilityBps,
    kind: stage.kind,
    dealCount,
  };
}

function checkedProbability(bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw crmError('crm.invalid', 'Probability must be between 0% and 100%');
  }
  return bps;
}

async function getStage(ctx: QueryCtx | MutationCtx, stageId: Id<'pipelineStages'>) {
  const stage = await ctx.db.get('pipelineStages', stageId);
  if (!stage) throw crmError('crm.notFound', 'Stage not found');
  return stage;
}

export const stages = teamQuery('deals.view')({
  args: {},
  handler: async (ctx) => {
    const all = await orderedStages(ctx);
    return await Promise.all(
      all.map(async (stage) => {
        const deals = await ctx.db
          .query('deals')
          .withIndex('by_stage', (q) => q.eq('stageId', stage._id))
          .collect();
        return stageView(stage, deals.length);
      }),
    );
  },
});

export const createStage = teamMutation('deals.manage')({
  args: { name: v.string(), probabilityBps: v.number() },
  handler: async (ctx, args) => {
    const all = await orderedStages(ctx);
    const name = text(args.name, 'Stage name', { required: true, max: 60 })!;
    if (all.some((stage) => stage.name.toLowerCase() === name.toLowerCase())) {
      throw crmError('crm.duplicate', `There is already a ${name} stage`);
    }
    const open = all.filter((stage) => stage.kind === 'open');
    const id = await ctx.db.insert('pipelineStages', {
      name,
      probabilityBps: checkedProbability(args.probabilityBps),
      kind: 'open',
      order: open.length,
    });
    await renumber(ctx, [...open.map((stage) => stage._id), id]);
    return id;
  },
});

/** Renames a stage or changes its default probability. Won stays 100% and Lost 0%. Existing deals keep theirs. */
export const updateStage = teamMutation('deals.manage')({
  args: { stageId: v.id('pipelineStages'), name: v.string(), probabilityBps: v.number() },
  handler: async (ctx, { stageId, ...args }) => {
    const stage = await getStage(ctx, stageId);
    const name = text(args.name, 'Stage name', { required: true, max: 60 })!;
    const all = await orderedStages(ctx);
    if (all.some((other) => other._id !== stageId && other.name.toLowerCase() === name.toLowerCase())) {
      throw crmError('crm.duplicate', `There is already a ${name} stage`);
    }
    const probabilityBps = stage.kind === 'open' ? checkedProbability(args.probabilityBps) : stage.probabilityBps;
    await ctx.db.patch('pipelineStages', stageId, { name, probabilityBps });
  },
});

/** Orders the given open stages first, then Won and Lost. */
async function renumber(ctx: MutationCtx, openIds: Id<'pipelineStages'>[]) {
  const all = await orderedStages(ctx);
  const closed = all
    .filter((stage) => stage.kind !== 'open')
    .sort((a, b) => (a.kind === 'won' ? -1 : b.kind === 'won' ? 1 : 0));
  const sequence = [...openIds, ...closed.map((stage) => stage._id)];
  for (const [order, id] of sequence.entries()) {
    const stage = all.find((candidate) => candidate._id === id);
    if (stage && stage.order !== order) await ctx.db.patch('pipelineStages', id, { order });
  }
}

export const reorderStages = teamMutation('deals.manage')({
  args: { openStageIds: v.array(v.id('pipelineStages')) },
  handler: async (ctx, { openStageIds }) => {
    const open = (await orderedStages(ctx)).filter((stage) => stage.kind === 'open');
    const same = openStageIds.length === open.length && open.every((stage) => openStageIds.includes(stage._id));
    if (!same || new Set(openStageIds).size !== openStageIds.length) {
      throw crmError('crm.invalid', 'List every open stage exactly once');
    }
    await renumber(ctx, openStageIds);
  },
});

/** Removes an open stage. Its deals move to another open stage first. The pipeline keeps at least one open stage. */
export const removeStage = teamMutation('deals.manage')({
  args: { stageId: v.id('pipelineStages'), moveDealsTo: v.optional(v.id('pipelineStages')) },
  handler: async (ctx, { stageId, moveDealsTo }) => {
    const stage = await getStage(ctx, stageId);
    if (stage.kind !== 'open') throw crmError('crm.invalid', 'The Won and Lost stages cannot be removed');
    const open = (await orderedStages(ctx)).filter((candidate) => candidate.kind === 'open');
    if (open.length === 1) throw crmError('crm.invalid', 'The pipeline needs at least one open stage');

    const deals = await ctx.db
      .query('deals')
      .withIndex('by_stage', (q) => q.eq('stageId', stageId))
      .collect();
    if (deals.length > 0) {
      const target = moveDealsTo ? await getStage(ctx, moveDealsTo) : null;
      if (!target || target.kind !== 'open' || target._id === stageId) {
        throw crmError(
          'crm.stageHasDeals',
          `${stage.name} has ${deals.length} deals. Choose an open stage to move them to.`,
        );
      }
      for (const deal of deals) await ctx.db.patch('deals', deal._id, { stageId: target._id });
    }
    await ctx.db.delete('pipelineStages', stageId);
    await renumber(
      ctx,
      open.filter((candidate) => candidate._id !== stageId).map((candidate) => candidate._id),
    );
  },
});

// Lost reasons ---------------------------------------------------------------------------------------------------------

export const lostReasons = teamQuery('deals.view')({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { includeInactive }) => {
    const reasons = await ctx.db.query('lostReasons').withIndex('by_order').collect();
    return reasons
      .filter((reason) => includeInactive || reason.active)
      .map((reason) => ({ id: reason._id, label: reason.label, active: reason.active }));
  },
});

async function assertUniqueReason(ctx: MutationCtx, label: string, exceptId?: Id<'lostReasons'>) {
  const reasons = await ctx.db.query('lostReasons').collect();
  if (reasons.some((reason) => reason._id !== exceptId && reason.label.toLowerCase() === label.toLowerCase())) {
    throw crmError('crm.duplicate', `"${label}" is already a lost reason`);
  }
}

export const createLostReason = teamMutation('deals.manage')({
  args: { label: v.string() },
  handler: async (ctx, args) => {
    const label = text(args.label, 'Reason', { required: true, max: 80 })!;
    await assertUniqueReason(ctx, label);
    const count = (await ctx.db.query('lostReasons').collect()).length;
    return await ctx.db.insert('lostReasons', { label, order: count, active: true });
  },
});

export const updateLostReason = teamMutation('deals.manage')({
  args: { reasonId: v.id('lostReasons'), label: v.string() },
  handler: async (ctx, { reasonId, ...args }) => {
    if (!(await ctx.db.get('lostReasons', reasonId))) throw crmError('crm.notFound', 'Reason not found');
    const label = text(args.label, 'Reason', { required: true, max: 80 })!;
    await assertUniqueReason(ctx, label, reasonId);
    await ctx.db.patch('lostReasons', reasonId, { label });
  },
});

/** Retired reasons stay on deals already lost with them but cannot be chosen again. */
export const setLostReasonActive = teamMutation('deals.manage')({
  args: { reasonId: v.id('lostReasons'), active: v.boolean() },
  handler: async (ctx, { reasonId, active }) => {
    if (!(await ctx.db.get('lostReasons', reasonId))) throw crmError('crm.notFound', 'Reason not found');
    await ctx.db.patch('lostReasons', reasonId, { active });
  },
});

export const reorderLostReasons = teamMutation('deals.manage')({
  args: { reasonIds: v.array(v.id('lostReasons')) },
  handler: async (ctx, { reasonIds }) => {
    const reasons = await ctx.db.query('lostReasons').collect();
    if (reasonIds.length !== reasons.length || reasons.some((reason) => !reasonIds.includes(reason._id))) {
      throw crmError('crm.invalid', 'List every reason exactly once');
    }
    for (const [order, id] of reasonIds.entries()) await ctx.db.patch('lostReasons', id, { order });
  },
});
