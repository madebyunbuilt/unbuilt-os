import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { recordActivity, requirePermission, text, website } from './lib/crm';
import { notifyTeamMembers } from './lib/notify';
import { deleteFile, recordUpload } from './lib/files';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { type TeamPrincipal } from './lib/principals';
import { assertOpen, notFound, projectError, visibleProject } from './lib/projects';

// Deliverables and versions (06-projects.md, Milestones and deliverables). The team drafts deliverables and submits
// versions (files and links with notes), which puts them in review. The client approves or asks for changes in the
// portal; `recordClientDecision` applies that decision and approves the milestone when all its deliverables are
// approved. Invoice drafts on milestone approval arrive with billing schedules.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };

const MAX_VERSION_FILES = 20;
const MAX_VERSION_LINKS = 20;

/** The deliverable and its project, for a caller with deliverables.manage.assigned within project scope. */
async function manageable(ctx: MutationCtx & Principal, deliverableId: Id<'deliverables'>) {
  const deliverable = await ctx.db.get('deliverables', deliverableId);
  if (!deliverable) throw notFound('Deliverable');
  const project = await visibleProject(ctx, ctx.principal, deliverable.projectId);
  requirePermission(ctx.principal, 'deliverables.manage.assigned');
  return { deliverable, project };
}

async function checkedMilestone(ctx: Ctx, projectId: Id<'projects'>, milestoneId: Id<'milestones'> | undefined) {
  if (!milestoneId) return undefined;
  const milestone = await ctx.db.get('milestones', milestoneId);
  if (!milestone || milestone.projectId !== projectId)
    throw projectError('projects.invalid', 'Choose a milestone of this project');
  if (milestone.status === 'approved' || milestone.status === 'invoiced') {
    throw projectError('projects.locked', `${milestone.name} is already ${milestone.status}`);
  }
  return milestoneId;
}

export const get = teamQuery(null)({
  args: { deliverableId: v.id('deliverables') },
  handler: async (ctx, { deliverableId }) => {
    const deliverable = await ctx.db.get('deliverables', deliverableId);
    if (!deliverable) throw notFound('Deliverable');
    await visibleProject(ctx, ctx.principal, deliverable.projectId);
    const versions = await ctx.db
      .query('deliverableVersions')
      .withIndex('by_deliverable_version', (q) => q.eq('deliverableId', deliverableId))
      .order('desc')
      .collect();
    const milestone = deliverable.milestoneId ? await ctx.db.get('milestones', deliverable.milestoneId) : null;
    const approver = deliverable.approvedByContactId
      ? await ctx.db.get('contacts', deliverable.approvedByContactId)
      : null;
    return {
      id: deliverable._id,
      projectId: deliverable.projectId,
      milestone: milestone ? { id: milestone._id, name: milestone.name, status: milestone.status } : null,
      title: deliverable.title,
      description: deliverable.description,
      status: deliverable.status,
      currentVersion: deliverable.currentVersion,
      approvedVersion: deliverable.approvedVersion,
      approvedAt: deliverable.approvedAt,
      approvedByName: approver?.name,
      // What the client last asked for, named, so the studio reads it on the page it will work from.
      changesAsked: deliverable.changesAsked
        ? {
            note: deliverable.changesAsked.note,
            at: deliverable.changesAsked.at,
            version: deliverable.changesAsked.version,
            byName: (await ctx.db.get('contacts', deliverable.changesAsked.byContactId))?.name ?? 'The client',
          }
        : null,
      versions: await Promise.all(
        versions.map(async (version) => ({
          version: version.version,
          notes: version.notes,
          links: version.links,
          submittedAt: version.submittedAt,
          submittedByName: (await ctx.db.get('teamMembers', version.submittedByMemberId))?.name ?? 'Former member',
          files: (await Promise.all(version.fileIds.map((id) => ctx.db.get('files', id))))
            .filter((file): file is Doc<'files'> => file !== null)
            .map((file) => ({ id: file._id, name: file.name, sizeBytes: file.sizeBytes, mimeType: file.mimeType })),
        })),
      ),
    };
  },
});

const fields = { title: v.string(), description: v.optional(v.string()), milestoneId: v.optional(v.id('milestones')) };

export const create = teamMutation('deliverables.manage.assigned')({
  args: { projectId: v.id('projects'), ...fields },
  handler: async (ctx, { projectId, ...args }) => {
    const project = await visibleProject(ctx, ctx.principal, projectId);
    assertOpen(project);
    return await ctx.db.insert('deliverables', {
      projectId,
      milestoneId: await checkedMilestone(ctx, projectId, args.milestoneId),
      title: text(args.title, 'Title', { required: true, max: 120 })!,
      description: text(args.description, 'Description', { max: 5000 }),
      status: 'draft',
      currentVersion: 0,
    });
  },
});

export const update = teamMutation('deliverables.manage.assigned')({
  args: { deliverableId: v.id('deliverables'), ...fields },
  handler: async (ctx, { deliverableId, ...args }) => {
    const { deliverable, project } = await manageable(ctx, deliverableId);
    assertOpen(project);
    if (deliverable.status === 'approved')
      throw projectError('projects.locked', 'An approved deliverable cannot change');
    await ctx.db.patch('deliverables', deliverableId, {
      title: text(args.title, 'Title', { required: true, max: 120 })!,
      description: text(args.description, 'Description', { max: 5000 }),
      milestoneId: await checkedMilestone(ctx, deliverable.projectId, args.milestoneId),
    });
  },
});

/** Deletes a deliverable that has never been submitted. */
export const remove = teamMutation('deliverables.manage.assigned')({
  args: { deliverableId: v.id('deliverables') },
  handler: async (ctx, { deliverableId }) => {
    const { deliverable, project } = await manageable(ctx, deliverableId);
    assertOpen(project);
    if (deliverable.currentVersion > 0) {
      throw projectError('projects.locked', 'A deliverable with submitted versions stays on record');
    }
    await ctx.db.delete('deliverables', deliverableId);
  },
});

export const generateUploadUrl = teamMutation('deliverables.manage.assigned')({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/**
 * Submits a new version for review: files uploaded to storage, links and notes. The deliverable goes to in review and
 * its milestone to awaiting approval. An approved deliverable takes no more versions. If any file is refused, nothing
 * is submitted and the reason is returned.
 */
export const submitVersion = teamMutation('deliverables.manage.assigned')({
  args: {
    deliverableId: v.id('deliverables'),
    uploads: v.array(v.object({ storageId: v.id('_storage'), name: v.string(), contentType: v.string() })),
    links: v.array(v.object({ label: v.optional(v.string()), url: v.string() })),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { deliverableId, uploads, links, notes }) => {
    const { deliverable, project } = await manageable(ctx, deliverableId);
    assertOpen(project);
    if (deliverable.status === 'approved') {
      throw projectError('projects.locked', 'This deliverable is approved. Add a new deliverable for further work.');
    }
    if (uploads.length === 0 && links.length === 0) {
      throw projectError('projects.invalid', 'Add at least one file or link');
    }
    if (uploads.length > MAX_VERSION_FILES || links.length > MAX_VERSION_LINKS) {
      throw projectError('projects.invalid', `Use up to ${MAX_VERSION_FILES} files and ${MAX_VERSION_LINKS} links`);
    }
    const checkedLinks = links.map((link) => ({
      label: text(link.label, 'Link label', { max: 80 }),
      url: website(link.url)!,
    }));

    const fileIds: Id<'files'>[] = [];
    for (const upload of uploads) {
      const result = await recordUpload(ctx, {
        ...upload,
        context: 'deliverable',
        owner: { table: 'deliverables', id: deliverableId },
        // Client contacts review submitted versions in the portal.
        visibility: 'client',
        clientId: project.clientId,
        projectId: project._id,
        uploadedBy: { kind: 'team', id: ctx.principal.member._id },
      });
      if (!result.ok) {
        for (const fileId of fileIds) await deleteFile(ctx, fileId);
        return result;
      }
      fileIds.push(result.fileId);
    }

    const version = deliverable.currentVersion + 1;
    await ctx.db.insert('deliverableVersions', {
      deliverableId,
      projectId: project._id,
      version,
      fileIds,
      links: checkedLinks,
      notes: text(notes, 'Notes', { max: 5000 }),
      submittedByMemberId: ctx.principal.member._id,
      submittedAt: Date.now(),
    });
    await ctx.db.patch('deliverables', deliverableId, {
      status: 'in_review',
      currentVersion: version,
      // This version is the answer to what was asked, so the ask stops standing.
      changesAsked: undefined,
    });
    if (deliverable.milestoneId) {
      const milestone = await ctx.db.get('milestones', deliverable.milestoneId);
      if (milestone && ['upcoming', 'in_progress'].includes(milestone.status)) {
        await ctx.db.patch('milestones', milestone._id, { status: 'awaiting_approval' });
      }
    }
    return { ok: true as const, version };
  },
});

/**
 * Tells the people whose work it is (14-platform.md): the project's manager and whoever submitted the version. A
 * decision nobody hears about leaves the client waiting on a studio that does not know it has been asked.
 */
async function tellTheStudio(
  ctx: { db: MutationCtx['db'] },
  deliverable: Doc<'deliverables'>,
  notice: { title: string; body: string },
) {
  const [project, version] = await Promise.all([
    ctx.db.get('projects', deliverable.projectId),
    ctx.db
      .query('deliverableVersions')
      .withIndex('by_deliverable_version', (q) =>
        q.eq('deliverableId', deliverable._id).eq('version', deliverable.currentVersion),
      )
      .unique(),
  ]);
  const tell = [project?.managerMemberId, version?.submittedByMemberId].filter((id): id is Id<'teamMembers'> =>
    Boolean(id),
  );
  await notifyTeamMembers(ctx, tell, {
    event: 'deliverable_decided',
    ...notice,
    link: `/projects/${deliverable.projectId}/deliverables/${deliverable._id}`,
  });
  if (project) {
    await recordActivity(ctx, {
      subject: { table: 'clients', id: project.clientId },
      clientId: project.clientId,
      type: 'status_change',
      title: notice.title,
      body: notice.body,
      actor: { kind: 'client', id: deliverable.approvedByContactId },
      meta: { deliverableId: deliverable._id, projectId: deliverable.projectId },
    });
  }
}

/**
 * Applies a client's decision on the version in review (called by the portal in the client portal step). Approval
 * records the contact, time and version, and approves the milestone once every deliverable in it is approved.
 */
export async function applyClientDecision(
  ctx: { db: MutationCtx['db'] },
  args: {
    deliverableId: Id<'deliverables'>;
    contactId: Id<'contacts'>;
    version: number;
    decision: 'approved' | 'changes_requested';
    /** What the client wants changed, in their words. Kept on the timeline, not only in a notification. */
    note?: string;
    now: number;
  },
): Promise<{ milestoneApproved: Id<'milestones'> | null }> {
  const deliverable = await ctx.db.get('deliverables', args.deliverableId);
  if (!deliverable) throw notFound('Deliverable');
  if (deliverable.status !== 'in_review') {
    throw projectError('projects.notInReview', 'This deliverable is not waiting for review');
  }
  if (deliverable.currentVersion !== args.version) {
    throw projectError(
      'projects.staleVersion',
      `Version ${args.version} has been replaced by version ${deliverable.currentVersion}`,
    );
  }
  const contact = await ctx.db.get('contacts', args.contactId);
  const said = text(args.note, 'Note', { max: 2000 });
  if (args.decision === 'changes_requested') {
    await ctx.db.patch('deliverables', deliverable._id, {
      status: 'changes_requested',
      changesAsked: said ? { note: said, byContactId: args.contactId, at: args.now, version: args.version } : undefined,
    });
    await tellTheStudio(ctx, deliverable, {
      title: `${contact?.name ?? 'The client'} asked for changes to ${deliverable.title}`,
      body: said ?? 'No note was left.',
    });
    return { milestoneApproved: null };
  }
  await ctx.db.patch('deliverables', deliverable._id, {
    status: 'approved',
    approvedAt: args.now,
    approvedByContactId: args.contactId,
    approvedVersion: args.version,
  });
  await tellTheStudio(ctx, deliverable, {
    title: `${contact?.name ?? 'The client'} approved ${deliverable.title}`,
    body: said ?? `Version ${args.version}.`,
  });
  if (!deliverable.milestoneId) return { milestoneApproved: null };
  const siblings = await ctx.db
    .query('deliverables')
    .withIndex('by_milestone', (q) => q.eq('milestoneId', deliverable.milestoneId))
    .collect();
  const allApproved = siblings.every((d) => (d._id === deliverable._id ? true : d.status === 'approved'));
  const milestone = await ctx.db.get('milestones', deliverable.milestoneId);
  if (!allApproved || !milestone || milestone.status === 'approved' || milestone.status === 'invoiced') {
    return { milestoneApproved: null };
  }
  await ctx.db.patch('milestones', milestone._id, {
    status: 'approved',
    approvedAt: args.now,
    approvedByContactId: args.contactId,
  });
  return { milestoneApproved: milestone._id };
}

/** For the portal step's approval function and tests. */
export const recordClientDecision = internalMutation({
  args: {
    deliverableId: v.id('deliverables'),
    contactId: v.id('contacts'),
    version: v.number(),
    decision: v.union(v.literal('approved'), v.literal('changes_requested')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await applyClientDecision(ctx, { ...args, now: Date.now() });
    if (result.milestoneApproved) {
      // An approved milestone may be what a billing schedule was waiting for (08-billing-and-finance.md).
      await ctx.scheduler.runAfter(0, internal.billingSchedules.onMilestoneApproved, {
        milestoneId: result.milestoneApproved,
      });
    }
    return result;
  },
});
