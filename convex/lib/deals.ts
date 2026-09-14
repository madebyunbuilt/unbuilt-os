import { type Doc } from '../_generated/dataModel';
import { type QueryCtx, type MutationCtx } from '../_generated/server';
import { applyBps, type Currency } from './money';

// Pipeline and deals (05-crm.md, Pipeline and deals).

type Ctx = QueryCtx | MutationCtx;

export const DEFAULT_PIPELINE_STAGES = [
  { name: 'New', probabilityBps: 1000, kind: 'open' },
  { name: 'Discovery', probabilityBps: 2500, kind: 'open' },
  { name: 'Proposal sent', probabilityBps: 5000, kind: 'open' },
  { name: 'Negotiation', probabilityBps: 7500, kind: 'open' },
  { name: 'Won', probabilityBps: 10000, kind: 'won' },
  { name: 'Lost', probabilityBps: 0, kind: 'lost' },
] as const;

export const DEFAULT_LOST_REASONS = [
  'Budget',
  'Timing',
  'Went with another studio',
  'Built it in-house',
  'No response',
  'Not a fit',
  'Other',
] as const;

/** A deal is idle after this long with no timeline entry and no future follow-up. */
export const DEAL_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

export async function orderedStages(ctx: Ctx): Promise<Doc<'pipelineStages'>[]> {
  return await ctx.db.query('pipelineStages').withIndex('by_order').collect();
}

export type PipelineTotals = Partial<Record<Currency, { count: number; valueMinor: number; weightedMinor: number }>>;

/**
 * Pipeline value per currency: the sum of open deal values, and the weighted value, the sum of each deal's value ×
 * its probability (rounded per deal). Currencies are never added together; conversion to NGN is for display only.
 */
export function pipelineTotals(deals: Pick<Doc<'deals'>, 'valueMinor' | 'currency' | 'probabilityBps'>[]) {
  const totals: PipelineTotals = {};
  for (const deal of deals) {
    const entry = (totals[deal.currency] ??= { count: 0, valueMinor: 0, weightedMinor: 0 });
    entry.count += 1;
    entry.valueMinor += deal.valueMinor;
    entry.weightedMinor += applyBps(deal.valueMinor, deal.probabilityBps);
  }
  return totals;
}

/**
 * Which follow-up reminders a deal needs today (05-crm.md, Follow-ups). `today` and the follow-up date are studio-local
 * dates; `activityDate` is the studio-local date of the latest timeline entry.
 */
export function followUpReminders(
  deal: Pick<Doc<'deals'>, 'lastActivityAt' | 'nextFollowUpDate' | 'idleNotifiedAt' | 'followUpNotifiedFor'>,
  { now, today, activityDate }: { now: number; today: string; activityDate: string },
): { idle: boolean; followUpDue: boolean } {
  const followUp = deal.nextFollowUpDate;
  // Passed or due today, nothing logged on or after that date, not yet reminded for it.
  const followUpDue =
    followUp !== undefined && followUp <= today && activityDate < followUp && deal.followUpNotifiedFor !== followUp;
  const hasFutureFollowUp = followUp !== undefined && followUp >= today;
  // Once per idle period: new activity after the last reminder starts a new period.
  const idle =
    now - deal.lastActivityAt >= DEAL_IDLE_MS &&
    !hasFutureFollowUp &&
    (deal.idleNotifiedAt === undefined || deal.idleNotifiedAt < deal.lastActivityAt);
  return { idle, followUpDue };
}
