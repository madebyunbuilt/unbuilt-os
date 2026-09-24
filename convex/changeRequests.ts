import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { appendScheduleItem } from './billingSchedules';
import {
  assertDecidable,
  assertSendable,
  changeRequestError,
  DEFAULT_SIGNATURE_THRESHOLD_MINOR,
  needsSignature,
  pushedDueDate,
} from './lib/changeRequests';
import { getClient, recordActivity, text } from './lib/crm';
import { draftDocument } from './documents';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { draftInvoice } from './lib/invoices';
import { formatMoney } from './lib/money';
import { nextNumber } from './lib/numbering';
import { notifyTeamMembers } from './lib/notify';
import { getOrgSettings } from './lib/settings';
import { assertOpen, notFound, visibleProject } from './lib/projects';

// Change requests (06-projects.md, Change requests). A priced change to agreed scope: the studio drafts it, the client
// approves or declines it — by signature above the studio's threshold — and an approval moves the project's budget and
// due date and bills the amount, exactly once.

function view(changeRequest: Doc<'changeRequests'>) {
  return {
    id: changeRequest._id,
    number: changeRequest.number,
    projectId: changeRequest.projectId,
    clientId: changeRequest.clientId,
    title: changeRequest.title,
    description: changeRequest.description,
    reason: changeRequest.reason,
    impact: changeRequest.impact,
    billing: changeRequest.billing,
    status: changeRequest.status,
    needsSignature: changeRequest.needsSignature,
    documentId: changeRequest.documentId,
    decidedAt: changeRequest.decidedAt,
    declineReason: changeRequest.declineReason,
    invoiceId: changeRequest.invoiceId,
    appliedAt: changeRequest.appliedAt,
  };
}

export const listForProject = teamQuery(null)({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await visibleProject(ctx, ctx.principal, projectId);
    const rows = await ctx.db
      .query('changeRequests')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId))
      .collect();
    return rows.map(view);
  },
});

export const get = teamQuery(null)({
  args: { changeRequestId: v.id('changeRequests') },
  handler: async (ctx, { changeRequestId }) => {
    const changeRequest = await ctx.db.get('changeRequests', changeRequestId);
    if (!changeRequest) throw notFound('Change request');
    await visibleProject(ctx, ctx.principal, changeRequest.projectId);
    return view(changeRequest);
  },
});

const details = {
  title: v.string(),
  description: v.string(),
  reason: v.string(),
  amountMinor: v.number(),
  days: v.number(),
  billing: v.optional(v.union(v.literal('invoice_now'), v.literal('with_the_schedule'))),
};

function checkedDetails(args: {
  title: string;
  description: string;
  reason: string;
  amountMinor: number;
  days: number;
}) {
  if (args.amountMinor < 0) throw changeRequestError('changeRequests.invalid', 'An amount cannot be negative');
  if (args.days < 0) throw changeRequestError('changeRequests.invalid', 'Days cannot be negative');
  return {
    title: text(args.title, 'Title', { required: true, max: 200 })!,
    description: text(args.description, 'Description', { required: true, max: 5000 })!,
    reason: text(args.reason, 'Reason', { required: true, max: 2000 })!,
  };
}

export const create = teamMutation('changerequests.create')({
  args: { projectId: v.id('projects'), ...details },
  handler: async (ctx, args) => {
    const project = await visibleProject(ctx, ctx.principal, args.projectId);
    assertOpen(project);
    return await ctx.db.insert('changeRequests', {
      projectId: project._id,
      clientId: project.clientId,
      ...checkedDetails(args),
      // A change request is priced in the project's own currency; the two are added together.
      impact: { amountMinor: args.amountMinor, currency: project.currency, days: args.days },
      billing: args.billing ?? 'invoice_now',
      status: 'draft',
      createdByMemberId: ctx.principal.member._id,
    });
  },
});

async function getChangeRequest(ctx: MutationCtx, changeRequestId: Id<'changeRequests'>) {
  const changeRequest = await ctx.db.get('changeRequests', changeRequestId);
  if (!changeRequest) throw notFound('Change request');
  return changeRequest;
}

export const update = teamMutation('changerequests.create')({
  args: { changeRequestId: v.id('changeRequests'), ...details },
  handler: async (ctx, { changeRequestId, ...args }) => {
    const changeRequest = await getChangeRequest(ctx, changeRequestId);
    await visibleProject(ctx, ctx.principal, changeRequest.projectId);
    if (changeRequest.status !== 'draft') {
      throw changeRequestError('changeRequests.sent', 'This change request is already with the client');
    }
    await ctx.db.patch('changeRequests', changeRequestId, {
      ...checkedDetails(args),
      impact: { ...changeRequest.impact, amountMinor: args.amountMinor, days: args.days },
      billing: args.billing ?? changeRequest.billing,
    });
  },
});

export const remove = teamMutation('changerequests.create')({
  args: { changeRequestId: v.id('changeRequests') },
  handler: async (ctx, { changeRequestId }) => {
    const changeRequest = await getChangeRequest(ctx, changeRequestId);
    await visibleProject(ctx, ctx.principal, changeRequest.projectId);
    if (changeRequest.status !== 'draft') {
      throw changeRequestError('changeRequests.sent', 'A change request that has gone out stays on record');
    }
    await ctx.db.delete('changeRequests', changeRequestId);
  },
});

/**
 * Sends it to the client: it takes its number, generates its `change_request` document from the template with the
 * amount as its line, and goes out like any other document. Whether it needs a signature is settled now, so the rule
 * cannot move under a client who is already reading it.
 */
export const send = teamMutation('changerequests.send')({
  args: {
    changeRequestId: v.id('changeRequests'),
    contactIds: v.optional(v.array(v.id('contacts'))),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const changeRequest = await getChangeRequest(ctx, args.changeRequestId);
    const project = await visibleProject(ctx, ctx.principal, changeRequest.projectId);
    assertOpen(project);
    assertSendable(changeRequest);

    const [client, settings] = await Promise.all([getClient(ctx, changeRequest.clientId), getOrgSettings(ctx)]);
    const number = changeRequest.number ?? (await nextNumber(ctx, 'changeRequest'));
    const documentId =
      changeRequest.documentId ??
      (await draftDocument(ctx, {
        type: 'change_request',
        clientId: changeRequest.clientId,
        projectId: changeRequest.projectId,
        title: `${number}: ${changeRequest.title}`,
        currency: changeRequest.impact.currency,
        // The template's payment terms ask how this is paid for; the change request already knows.
        paymentScheduleSummary:
          changeRequest.impact.amountMinor === 0
            ? 'This change costs nothing; there is nothing further to pay.'
            : changeRequest.billing === 'with_the_schedule'
              ? `${formatMoney(changeRequest.impact.amountMinor, changeRequest.impact.currency)} added to the payment schedule already agreed for this project, and invoiced with it.`
              : `${formatMoney(changeRequest.impact.amountMinor, changeRequest.impact.currency)} invoiced once this change is approved, on the payment terms already agreed.`,
        lineItems:
          changeRequest.impact.amountMinor > 0
            ? [
                {
                  description: changeRequest.title,
                  quantityMilli: 1_000,
                  unitPriceMinor: changeRequest.impact.amountMinor,
                  taxable: true,
                },
              ]
            : [],
      }));

    await ctx.db.patch('changeRequests', changeRequest._id, {
      number,
      documentId,
      status: 'sent',
      needsSignature: needsSignature(
        changeRequest.impact.amountMinor,
        client,
        settings.changeRequestSignatureMinor ?? DEFAULT_SIGNATURE_THRESHOLD_MINOR,
      ),
    });
    await ctx.scheduler.runAfter(0, internal.documentSending.send, {
      documentId,
      memberId: ctx.principal.member._id,
      contactIds: args.contactIds,
      message: text(args.message, 'Message', { max: 2000 }),
    });
    return { documentId, number };
  },
});

/** Taken back before the client decided; it stays on record. */
export const withdraw = teamMutation('changerequests.send')({
  args: { changeRequestId: v.id('changeRequests'), reason: v.string() },
  handler: async (ctx, { changeRequestId, reason }) => {
    const changeRequest = await getChangeRequest(ctx, changeRequestId);
    await visibleProject(ctx, ctx.principal, changeRequest.projectId);
    assertDecidable(changeRequest);
    await ctx.db.patch('changeRequests', changeRequestId, {
      status: 'withdrawn',
      declineReason: text(reason, 'Reason', { required: true, max: 500 }),
      decidedByMemberId: ctx.principal.member._id,
      decidedAt: Date.now(),
    });
  },
});

/**
 * Applies the client's decision. Approval moves the project's budget and due date and bills the amount; `appliedAt` is
 * what makes that happen exactly once, however the approval arrives (portal, signature, or recorded by the studio).
 */
export async function applyDecision(
  ctx: MutationCtx,
  args: {
    changeRequestId: Id<'changeRequests'>;
    decision: 'approved' | 'declined';
    contactId?: Id<'contacts'>;
    memberId?: Id<'teamMembers'>;
    reason?: string;
    now: number;
  },
): Promise<{ invoiceId: Id<'invoices'> | null }> {
  const changeRequest = await getChangeRequest(ctx, args.changeRequestId);
  assertDecidable(changeRequest);
  const decided = {
    status: args.decision,
    decidedAt: args.now,
    decidedByContactId: args.contactId,
    decidedByMemberId: args.memberId,
  } as const;

  if (args.decision === 'declined') {
    await ctx.db.patch('changeRequests', changeRequest._id, {
      ...decided,
      declineReason: text(args.reason, 'Reason', { max: 500 }),
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: changeRequest.clientId },
      clientId: changeRequest.clientId,
      type: 'system',
      title: `${changeRequest.number} declined`,
      body: args.reason,
      actor: args.memberId ? { kind: 'team', id: args.memberId } : { kind: 'client', id: args.contactId },
      meta: { changeRequestId: changeRequest._id, projectId: changeRequest.projectId },
    });
    return { invoiceId: null };
  }

  const project = await ctx.db.get('projects', changeRequest.projectId);
  if (!project) throw notFound('Project');
  // Budget and due date move together with the money, so the project still says what was agreed.
  await ctx.db.patch('projects', project._id, {
    budgetMinor: (project.budgetMinor ?? 0) + changeRequest.impact.amountMinor,
    dueDate: pushedDueDate(project.dueDate, changeRequest.impact.days),
  });

  let invoiceId: Id<'invoices'> | null = null;
  let scheduleItemId: string | undefined;
  if (changeRequest.impact.amountMinor > 0) {
    const appended =
      changeRequest.billing === 'with_the_schedule'
        ? await appendScheduleItem(ctx, {
            projectId: project._id,
            label: `${changeRequest.number}: ${changeRequest.title}`,
            amountMinor: changeRequest.impact.amountMinor,
          })
        : null;
    scheduleItemId = appended ?? undefined;
    // No schedule to join means it is billed now, rather than quietly not at all.
    if (!appended) {
      invoiceId = await draftInvoice(ctx, {
        clientId: changeRequest.clientId,
        projectId: project._id,
        type: 'change_request',
        currency: changeRequest.impact.currency,
        lineItems: [
          {
            description: `${changeRequest.number}: ${changeRequest.title}`,
            quantityMilli: 1_000,
            unitPriceMinor: changeRequest.impact.amountMinor,
            amountMinor: changeRequest.impact.amountMinor,
            taxable: true,
          },
        ],
        createdByMemberId: args.memberId ?? changeRequest.createdByMemberId,
      });
    }
  }

  await ctx.db.patch('changeRequests', changeRequest._id, {
    ...decided,
    appliedAt: args.now,
    invoiceId: invoiceId ?? undefined,
    scheduleItemId,
  });
  await recordActivity(ctx, {
    subject: { table: 'clients', id: changeRequest.clientId },
    clientId: changeRequest.clientId,
    type: 'system',
    title: `${changeRequest.number} approved: ${formatMoney(changeRequest.impact.amountMinor, changeRequest.impact.currency)}${
      changeRequest.impact.days > 0 ? ` and ${changeRequest.impact.days} days` : ''
    }`,
    actor: args.memberId ? { kind: 'team', id: args.memberId } : { kind: 'client', id: args.contactId },
    meta: { changeRequestId: changeRequest._id, projectId: changeRequest.projectId, invoiceId },
  });
  if (invoiceId) {
    await notifyTeamMembers(ctx, [changeRequest.createdByMemberId], {
      event: 'invoice_ready_to_send',
      title: `${changeRequest.number} is ready to invoice`,
      body: `${formatMoney(changeRequest.impact.amountMinor, changeRequest.impact.currency)} drafted from the approved change request.`,
      link: `/billing/invoices/${invoiceId}`,
    });
  }
  return { invoiceId };
}

/**
 * The studio recording a decision the client gave outside the portal, as documents allow. A change request that needs a
 * signature is approved by the signature itself, never by hand.
 */
export const recordDecision = teamMutation('changerequests.send')({
  args: {
    changeRequestId: v.id('changeRequests'),
    decision: v.union(v.literal('approved'), v.literal('declined')),
    contactId: v.optional(v.id('contacts')),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const changeRequest = await getChangeRequest(ctx, args.changeRequestId);
    await visibleProject(ctx, ctx.principal, changeRequest.projectId);
    if (changeRequest.needsSignature && args.decision === 'approved') {
      throw changeRequestError(
        'changeRequests.needsSignature',
        'This change request is approved by signing it, not by recording an approval',
      );
    }
    return await applyDecision(ctx, {
      changeRequestId: args.changeRequestId,
      decision: args.decision,
      contactId: args.contactId,
      memberId: ctx.principal.member._id,
      reason: args.reason,
      now: Date.now(),
    });
  },
});

/** For the portal step's approval function and tests. */
export const recordClientDecision = internalMutation({
  args: {
    changeRequestId: v.id('changeRequests'),
    decision: v.union(v.literal('approved'), v.literal('declined')),
    contactId: v.id('contacts'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => await applyDecision(ctx, { ...args, now: Date.now() }),
});

/** The client signed the change request: that signature is the approval. */
export const onDocumentSigned = internalMutation({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }): Promise<null> => {
    const changeRequest = await ctx.db
      .query('changeRequests')
      .withIndex('by_document', (q) => q.eq('documentId', documentId))
      .unique();
    if (!changeRequest || changeRequest.status !== 'sent') return null;
    const document = await ctx.db.get('documents', documentId);
    await applyDecision(ctx, {
      changeRequestId: changeRequest._id,
      decision: 'approved',
      contactId: document?.acceptedByContactId,
      now: Date.now(),
    });
    return null;
  },
});
