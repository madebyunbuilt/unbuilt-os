import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { applyClientDecision } from './deliverables';
import { applyDecision } from './changeRequests';
import { portalMutation, portalQuery } from './lib/functions';
import { type ClientPrincipal } from './lib/principals';
import { projectError } from './lib/projects';
import { splitUsage } from './lib/retainers';

// A project as its client sees it (12-client-portal.md, Projects): what has been delivered for them to review, what
// they have been asked to decide, and where their retainer hours stand. The studio's own working papers — internal
// comments, costs, rates, time entries — are not read here at all.

async function ownProject(ctx: QueryCtx | MutationCtx, projectId: Id<'projects'>, clientId: Id<'clients'>) {
  const project = await ctx.db.get('projects', projectId);
  if (!project || project.clientId !== clientId || project.status === 'archived') return null;
  return project;
}

/** A deliverable the client has been shown: a draft is the studio's until a version is submitted. */
const SHOWN: ReadonlySet<Doc<'deliverables'>['status']> = new Set(['in_review', 'changes_requested', 'approved']);

/** Everything on one project a client may see, in the order they would work through it. */
export const project = portalQuery('portal.projects.view')({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const principal = ctx.principal as ClientPrincipal;
    const found = await ownProject(ctx, projectId, principal.clientId);
    if (!found) return null;

    const [milestones, deliverables, changeRequests, retainer] = await Promise.all([
      ctx.db
        .query('milestones')
        .withIndex('by_project_order', (q) => q.eq('projectId', projectId))
        .collect(),
      ctx.db
        .query('deliverables')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect(),
      ctx.db
        .query('changeRequests')
        .withIndex('by_project_status', (q) => q.eq('projectId', projectId))
        .collect(),
      ctx.db
        .query('retainers')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .first(),
    ]);

    const shown = deliverables.filter((deliverable) => SHOWN.has(deliverable.status));
    const withVersions = await Promise.all(
      shown.map(async (deliverable) => {
        const version = await ctx.db
          .query('deliverableVersions')
          .withIndex('by_deliverable_version', (q) =>
            q.eq('deliverableId', deliverable._id).eq('version', deliverable.currentVersion),
          )
          .unique();
        return {
          id: deliverable._id,
          title: deliverable.title,
          description: deliverable.description,
          status: deliverable.status,
          version: deliverable.currentVersion,
          approvedAt: deliverable.approvedAt,
          // What the studio actually sent them to look at. Who made it and when they logged it is not their business.
          files: await Promise.all(
            (version?.fileIds ?? []).map(async (fileId) => {
              const file = await ctx.db.get('files', fileId);
              return { id: fileId, name: file?.name ?? 'Attachment', sizeBytes: file?.sizeBytes ?? 0 };
            }),
          ),
          links: version?.links ?? [],
          notes: version?.notes,
          needsYou: deliverable.status === 'in_review',
        };
      }),
    );

    return {
      id: found._id,
      code: found.code,
      name: found.name,
      status: found.status,
      startDate: found.startDate,
      dueDate: found.dueDate,
      milestones: milestones.map((milestone) => ({
        id: milestone._id,
        name: milestone.name,
        status: milestone.status,
        dueDate: milestone.dueDate,
      })),
      deliverables: withVersions,
      // A draft change request is the studio still thinking; the client sees it once it has been sent.
      changeRequests: changeRequests
        .filter((changeRequest) => changeRequest.status !== 'draft')
        .map((changeRequest) => ({
          id: changeRequest._id,
          number: changeRequest.number,
          title: changeRequest.title,
          description: changeRequest.description,
          reason: changeRequest.reason,
          impact: changeRequest.impact,
          status: changeRequest.status,
          // Above the studio's threshold it is agreed by signing the document, not by a button here.
          needsSignature: changeRequest.needsSignature ?? false,
          documentId: changeRequest.documentId,
          declineReason: changeRequest.declineReason,
        })),
      retainer: retainer ? await retainerHours(ctx, retainer) : null,
    };
  },
});

/** Where the client's retainer hours stand, in hours rather than the minutes the studio counts in. */
async function retainerHours(ctx: QueryCtx | MutationCtx, retainer: Doc<'retainers'>) {
  const period = await ctx.db
    .query('retainerPeriods')
    .withIndex('by_open', (q) => q.eq('retainerId', retainer._id).eq('closedAt', undefined))
    .first();
  if (!period) return null;
  const entries = await ctx.db
    .query('timeEntries')
    .withIndex('by_project_date', (q) =>
      q.eq('projectId', retainer.projectId).gte('date', period.periodStart).lte('date', period.periodEnd),
    )
    .collect();
  // Approved time only, and only the total: a client never reads what anybody wrote on a time entry.
  const usedMinutes = entries
    .filter((entry) => entry.status === 'approved' || entry.status === 'invoiced')
    .reduce((sum, entry) => sum + entry.minutes, 0);
  const split = splitUsage({ ...period, usedMinutes });
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    includedMinutes: period.includedMinutes + period.rolloverMinutes,
    usedMinutes,
    remainingMinutes: split.remainingMinutes,
    overageMinutes: split.overageMinutes,
  };
}

/**
 * The client approving what was delivered, or asking for changes. It writes the same record the studio's own path
 * does, with the contact as the actor, and an approved last deliverable closes its milestone exactly as before.
 */
export const decideDeliverable = portalMutation('portal.deliverables.approve')({
  args: {
    deliverableId: v.id('deliverables'),
    version: v.number(),
    decision: v.union(v.literal('approved'), v.literal('changes_requested')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = ctx.principal as ClientPrincipal;
    const deliverable = await ctx.db.get('deliverables', args.deliverableId);
    if (!deliverable || !(await ownProject(ctx, deliverable.projectId, principal.clientId))) {
      throw projectError('projects.notFound', 'That deliverable is not available');
    }
    const result = await applyClientDecision(ctx, {
      deliverableId: args.deliverableId,
      contactId: principal.contact._id,
      version: args.version,
      decision: args.decision,
      note: args.note,
      now: Date.now(),
    });
    if (result.milestoneApproved) {
      // The same trigger the studio's path fires: a milestone may be what a billing schedule was waiting for.
      await ctx.scheduler.runAfter(0, internal.billingSchedules.onMilestoneApproved, {
        milestoneId: result.milestoneApproved,
      });
    }
    return result;
  },
});

/**
 * The client deciding on a priced change. Approving moves the project's budget and due date and bills the amount,
 * once — the same function the studio calls, so there is one rule rather than two that could drift apart.
 */
export const decideChangeRequest = portalMutation('portal.changerequests.approve')({
  args: {
    changeRequestId: v.id('changeRequests'),
    decision: v.union(v.literal('approved'), v.literal('declined')),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = ctx.principal as ClientPrincipal;
    const changeRequest = await ctx.db.get('changeRequests', args.changeRequestId);
    if (!changeRequest || !(await ownProject(ctx, changeRequest.projectId, principal.clientId))) {
      throw projectError('projects.notFound', 'That change request is not available');
    }
    if (changeRequest.needsSignature && args.decision === 'approved') {
      throw projectError(
        'projects.needsSignature',
        'This change is agreed by signing it; your signing link is in your email',
      );
    }
    return await applyDecision(ctx, {
      changeRequestId: args.changeRequestId,
      decision: args.decision,
      contactId: principal.contact._id,
      reason: args.reason,
      now: Date.now(),
    });
  },
});
