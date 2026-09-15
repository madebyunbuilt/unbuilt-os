import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { auditedDatabase } from './lib/audit';
import { localDateString } from './lib/businessTime';
import { assertActiveMember, crmError, getClient, recordActivity, requirePermission, text } from './lib/crm';
import { followUpReminders, orderedStages, pipelineTotals } from './lib/deals';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { formatMoney } from './lib/money';
import { notifyTeamMembers } from './lib/notify';
import { type TeamPrincipal } from './lib/principals';
import { getOrgSettings } from './lib/settings';
import { isIsoDate } from './lib/validation';

// Deals (05-crm.md, Pipeline and deals). Won needs a project, which arrives with the projects step, so moving a deal to
// Won is refused until then (decided by the studio on 2026-09-14). Lost needs a reason from the list.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };

const currency = v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'));
const RECENT_CLOSED_MS = 90 * 24 * 60 * 60 * 1000;

export async function getDeal(ctx: Ctx, dealId: Id<'deals'>): Promise<Doc<'deals'>> {
  const deal = await ctx.db.get('deals', dealId);
  if (!deal) throw crmError('crm.notFound', 'Deal not found');
  return deal;
}

async function getStage(ctx: Ctx, stageId: Id<'pipelineStages'>) {
  const stage = await ctx.db.get('pipelineStages', stageId);
  if (!stage) throw crmError('crm.notFound', 'Stage not found');
  return stage;
}

function dealLink(dealId: Id<'deals'>) {
  return `/crm/deals/${dealId}`;
}

async function dealView(ctx: Ctx, deal: Doc<'deals'>) {
  const [client, stage, owner, contact, reason] = await Promise.all([
    ctx.db.get('clients', deal.clientId),
    ctx.db.get('pipelineStages', deal.stageId),
    ctx.db.get('teamMembers', deal.ownerMemberId),
    deal.primaryContactId ? ctx.db.get('contacts', deal.primaryContactId) : null,
    deal.lostReasonId ? ctx.db.get('lostReasons', deal.lostReasonId) : null,
  ]);
  return {
    id: deal._id,
    title: deal.title,
    clientId: deal.clientId,
    clientName: client?.displayName ?? 'Unknown client',
    primaryContact: contact ? { id: contact._id, name: contact.name, email: contact.email } : null,
    stage: stage ? { id: stage._id, name: stage.name, kind: stage.kind } : null,
    valueMinor: deal.valueMinor,
    currency: deal.currency,
    probabilityBps: deal.probabilityBps,
    expectedCloseDate: deal.expectedCloseDate,
    ownerMemberId: deal.ownerMemberId,
    ownerName: owner?.name ?? 'Former member',
    services: deal.services,
    source: deal.source,
    enquiryId: deal.enquiryId,
    lostReason: reason?.label,
    lostNote: deal.lostNote,
    wonAt: deal.wonAt,
    lostAt: deal.lostAt,
    nextFollowUpDate: deal.nextFollowUpDate,
    lastActivityAt: deal.lastActivityAt,
    createdAt: deal._creationTime,
  };
}

function checkedValue(valueMinor: number) {
  if (!Number.isSafeInteger(valueMinor) || valueMinor < 0) {
    throw crmError('crm.invalid', 'The value must be a whole, non-negative amount in minor units');
  }
  return valueMinor;
}

function checkedProbability(bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw crmError('crm.invalid', 'Probability must be between 0% and 100%');
  }
  return bps;
}

function checkedDate(value: string | undefined, label: string) {
  if (!value) return undefined;
  if (!isIsoDate(value)) throw crmError('crm.invalid', `${label} must be a date`);
  return value;
}

function checkedServices(values: string[]) {
  const cleaned = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (cleaned.length > 20 || cleaned.some((value) => value.length > 40)) {
    throw crmError('crm.invalid', 'Use up to 20 services');
  }
  return cleaned;
}

async function checkedContact(ctx: Ctx, clientId: Id<'clients'>, contactId: Id<'contacts'> | undefined) {
  if (!contactId) return undefined;
  const contact = await ctx.db.get('contacts', contactId);
  if (!contact || contact.clientId !== clientId || contact.status !== 'active') {
    throw crmError('crm.invalid', 'Choose an active contact at this client');
  }
  return contactId;
}

export const list = teamQuery('deals.view')({
  args: {
    status: v.optional(v.union(v.literal('open'), v.literal('won'), v.literal('lost'), v.literal('all'))),
    clientId: v.optional(v.id('clients')),
    ownerMemberId: v.optional(v.id('teamMembers')),
  },
  handler: async (ctx, { status = 'open', clientId, ownerMemberId }) => {
    const stages = new Map((await orderedStages(ctx)).map((stage) => [stage._id, stage]));
    const deals = clientId
      ? await ctx.db
          .query('deals')
          .withIndex('by_client', (q) => q.eq('clientId', clientId))
          .collect()
      : await ctx.db.query('deals').take(2000);
    const filtered = deals.filter(
      (deal) =>
        (status === 'all' || stages.get(deal.stageId)?.kind === status) &&
        (!ownerMemberId || deal.ownerMemberId === ownerMemberId),
    );
    const views = await Promise.all(filtered.map((deal) => dealView(ctx, deal)));
    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Stages in order, each with its deals. Won and Lost show deals closed in the last 90 days. */
export const board = teamQuery('deals.view')({
  args: { ownerMemberId: v.optional(v.id('teamMembers')) },
  handler: async (ctx, { ownerMemberId }) => {
    const now = Date.now();
    const stages = await orderedStages(ctx);
    return await Promise.all(
      stages.map(async (stage) => {
        const deals = (
          await ctx.db
            .query('deals')
            .withIndex('by_stage', (q) => q.eq('stageId', stage._id))
            .collect()
        ).filter((deal) => {
          if (ownerMemberId && deal.ownerMemberId !== ownerMemberId) return false;
          const closedAt = deal.wonAt ?? deal.lostAt;
          return stage.kind === 'open' || (closedAt !== undefined && now - closedAt <= RECENT_CLOSED_MS);
        });
        const views = await Promise.all(deals.map((deal) => dealView(ctx, deal)));
        return {
          id: stage._id,
          name: stage.name,
          kind: stage.kind,
          probabilityBps: stage.probabilityBps,
          deals: views.sort((a, b) => b.lastActivityAt - a.lastActivityAt),
        };
      }),
    );
  },
});

export const get = teamQuery('deals.view')({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => await dealView(ctx, await getDeal(ctx, dealId)),
});

/**
 * Pipeline value and weighted value of open deals, per currency. Currencies are never added together; conversion to
 * NGN for display arrives with FX rates in the billing step.
 */
export const pipelineSummary = teamQuery('deals.view')({
  args: { ownerMemberId: v.optional(v.id('teamMembers')) },
  handler: async (ctx, { ownerMemberId }) => {
    const open = (await orderedStages(ctx)).filter((stage) => stage.kind === 'open');
    const deals: Doc<'deals'>[] = [];
    for (const stage of open) {
      const inStage = await ctx.db
        .query('deals')
        .withIndex('by_stage', (q) => q.eq('stageId', stage._id))
        .collect();
      deals.push(...inStage.filter((deal) => !ownerMemberId || deal.ownerMemberId === ownerMemberId));
    }
    return pipelineTotals(deals);
  },
});

const editable = {
  title: v.string(),
  primaryContactId: v.optional(v.id('contacts')),
  valueMinor: v.number(),
  currency,
  probabilityBps: v.optional(v.number()),
  expectedCloseDate: v.optional(v.string()),
  ownerMemberId: v.optional(v.id('teamMembers')),
  services: v.array(v.string()),
  source: v.optional(v.string()),
  nextFollowUpDate: v.optional(v.string()),
};

/** Creates a deal, in the first open stage unless another open stage is given, with that stage's probability. */
export async function createDeal(
  ctx: MutationCtx & Principal,
  args: {
    clientId: Id<'clients'>;
    stageId?: Id<'pipelineStages'>;
    enquiryId?: Id<'enquiries'>;
    title: string;
    primaryContactId?: Id<'contacts'>;
    valueMinor: number;
    currency: Doc<'deals'>['currency'];
    probabilityBps?: number;
    expectedCloseDate?: string;
    ownerMemberId?: Id<'teamMembers'>;
    services: string[];
    source?: string;
    nextFollowUpDate?: string;
  },
): Promise<Id<'deals'>> {
  requirePermission(ctx.principal, 'deals.manage');
  await getClient(ctx, args.clientId);
  const stages = await orderedStages(ctx);
  const stage = args.stageId ? stages.find((s) => s._id === args.stageId) : stages.find((s) => s.kind === 'open');
  if (!stage || stage.kind !== 'open') throw crmError('crm.invalid', 'New deals start in an open stage');
  await assertActiveMember(ctx, args.ownerMemberId);

  const now = Date.now();
  const dealId = await ctx.db.insert('deals', {
    title: text(args.title, 'Title', { required: true, max: 120 })!,
    clientId: args.clientId,
    primaryContactId: await checkedContact(ctx, args.clientId, args.primaryContactId),
    stageId: stage._id,
    valueMinor: checkedValue(args.valueMinor),
    currency: args.currency,
    probabilityBps: args.probabilityBps === undefined ? stage.probabilityBps : checkedProbability(args.probabilityBps),
    expectedCloseDate: checkedDate(args.expectedCloseDate, 'Expected close date'),
    ownerMemberId: args.ownerMemberId ?? ctx.principal.member._id,
    services: checkedServices(args.services),
    source: text(args.source, 'Source', { max: 60 }),
    enquiryId: args.enquiryId,
    nextFollowUpDate: checkedDate(args.nextFollowUpDate, 'Follow-up date'),
    lastActivityAt: now,
  });
  await recordActivity(ctx, {
    subject: { table: 'deals', id: dealId },
    clientId: args.clientId,
    type: 'system',
    title: `Deal created in ${stage.name}`,
    actor: { kind: 'team', id: ctx.principal.member._id },
    occurredAt: now,
  });
  return dealId;
}

export const create = teamMutation('deals.manage')({
  args: { clientId: v.id('clients'), stageId: v.optional(v.id('pipelineStages')), ...editable },
  handler: async (ctx, args) => await createDeal(ctx, args),
});

export const update = teamMutation('deals.manage')({
  args: { dealId: v.id('deals'), ...editable },
  handler: async (ctx, { dealId, ...args }) => {
    const deal = await getDeal(ctx, dealId);
    await assertActiveMember(ctx, args.ownerMemberId);
    await ctx.db.patch('deals', dealId, {
      title: text(args.title, 'Title', { required: true, max: 120 })!,
      primaryContactId: await checkedContact(ctx, deal.clientId, args.primaryContactId),
      valueMinor: checkedValue(args.valueMinor),
      currency: args.currency,
      probabilityBps: args.probabilityBps === undefined ? deal.probabilityBps : checkedProbability(args.probabilityBps),
      expectedCloseDate: checkedDate(args.expectedCloseDate, 'Expected close date'),
      ownerMemberId: args.ownerMemberId ?? deal.ownerMemberId,
      services: checkedServices(args.services),
      source: text(args.source, 'Source', { max: 60 }),
      nextFollowUpDate: checkedDate(args.nextFollowUpDate, 'Follow-up date'),
    });
  },
});

export const setFollowUp = teamMutation('deals.manage')({
  args: { dealId: v.id('deals'), date: v.optional(v.string()) },
  handler: async (ctx, { dealId, date }) => {
    await getDeal(ctx, dealId);
    await ctx.db.patch('deals', dealId, { nextFollowUpDate: checkedDate(date, 'Follow-up date') });
  },
});

/**
 * Moves a deal to another stage and records it on the timeline. An open stage sets its default probability. Lost needs
 * a reason; Won is refused until projects exist. Reopening a lost deal clears the loss.
 */
export const moveToStage = teamMutation('deals.manage')({
  args: {
    dealId: v.id('deals'),
    stageId: v.id('pipelineStages'),
    lostReasonId: v.optional(v.id('lostReasons')),
    lostNote: v.optional(v.string()),
  },
  handler: async (ctx, { dealId, stageId, lostReasonId, lostNote }) => {
    const deal = await getDeal(ctx, dealId);
    const [from, to] = await Promise.all([getStage(ctx, deal.stageId), getStage(ctx, stageId)]);
    if (from._id === to._id) return;
    if (from.kind === 'won') throw crmError('crm.dealWon', 'A won deal stays won');
    if (to.kind === 'won') {
      throw crmError('crm.wonNeedsProject', 'Mark the deal as won with its project');
    }

    const now = Date.now();
    let changes: Partial<Doc<'deals'>>;
    let body: string | undefined;
    if (to.kind === 'lost') {
      const reason = lostReasonId ? await ctx.db.get('lostReasons', lostReasonId) : null;
      if (!reason?.active) throw crmError('crm.lostNeedsReason', 'Choose why the deal was lost');
      const note = text(lostNote, 'Note', { max: 1000 });
      changes = { stageId, lostReasonId: reason._id, lostNote: note, lostAt: now, probabilityBps: to.probabilityBps };
      body = note ? `${reason.label}: ${note}` : reason.label;
    } else {
      changes = {
        stageId,
        probabilityBps: to.probabilityBps,
        lostReasonId: undefined,
        lostNote: undefined,
        lostAt: undefined,
      };
    }
    await ctx.db.patch('deals', dealId, changes);
    await recordActivity(ctx, {
      subject: { table: 'deals', id: dealId },
      clientId: deal.clientId,
      type: 'status_change',
      title: `Moved from ${from.name} to ${to.name}`,
      body,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { fromStageId: from._id, toStageId: to._id },
      occurredAt: now,
    });
  },
});

/**
 * Deletes a deal entered by mistake, with its timeline. clients.delete (the Owner and Admins), like other deletions in
 * the CRM. An enquiry converted into it goes back to reviewed.
 */
export const remove = teamMutation('clients.delete')({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const deal = await getDeal(ctx, dealId);
    const entries = await ctx.db
      .query('activities')
      .withIndex('by_subject_occurred', (q) => q.eq('subject.table', 'deals').eq('subject.id', dealId))
      .collect();
    for (const entry of entries) await ctx.db.delete('activities', entry._id);
    if (deal.enquiryId) {
      const enquiry = await ctx.db.get('enquiries', deal.enquiryId);
      if (enquiry?.dealId === dealId) {
        await ctx.db.patch('enquiries', enquiry._id, { status: 'reviewed', dealId: undefined });
      }
    }
    await ctx.db.delete('deals', dealId);
  },
});

/**
 * Runs daily at 17:00 in Lagos (convex/crons.ts): reminds owners of follow-ups that came and went with nothing logged,
 * and of open deals idle for 7 days with no future follow-up, each once.
 */
export const sendFollowUpReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const db = auditedDatabase(ctx.db, { actorKind: 'system', permission: 'deals.followUpReminders' });
    const { timezone } = await getOrgSettings(ctx);
    const now = Date.now();
    const today = localDateString(now, timezone);
    let followUps = 0;
    let idle = 0;

    for (const stage of (await orderedStages(ctx)).filter((s) => s.kind === 'open')) {
      const deals = await ctx.db
        .query('deals')
        .withIndex('by_stage', (q) => q.eq('stageId', stage._id))
        .collect();
      for (const deal of deals) {
        const due = followUpReminders(deal, {
          now,
          today,
          activityDate: localDateString(deal.lastActivityAt, timezone),
        });
        const client = await ctx.db.get('clients', deal.clientId);
        const value = formatMoney(deal.valueMinor, deal.currency);
        if (due.followUpDue) {
          await notifyTeamMembers({ db }, [deal.ownerMemberId], {
            event: 'deal.followUpDue',
            title: `Follow up on ${deal.title}`,
            body: `${client?.displayName ?? 'Client'} · ${value}. The follow-up date was ${deal.nextFollowUpDate}.`,
            link: dealLink(deal._id),
          });
          await db.patch('deals', deal._id, { followUpNotifiedFor: deal.nextFollowUpDate });
          followUps++;
        } else if (due.idle) {
          await notifyTeamMembers({ db }, [deal.ownerMemberId], {
            event: 'deal.idle',
            title: `${deal.title} has gone quiet`,
            body: `${client?.displayName ?? 'Client'} · ${value}. Nothing logged for 7 days and no follow-up planned.`,
            link: dealLink(deal._id),
          });
          await db.patch('deals', deal._id, { idleNotifiedAt: now });
          idle++;
        }
      }
    }
    return { followUps, idle };
  },
});
