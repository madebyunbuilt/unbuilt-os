import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { mentionedMemberIds, plainMentions, text } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { notifyTeamMembers } from './lib/notify';
import { type TeamPrincipal } from './lib/principals';
import { notFound, projectError, visibleProject } from './lib/projects';

// Comments on deliverables and tasks (06-projects.md, Comments). Anyone who can see the project comments internally.
// Client-visible comments need the permission to manage the thing commented on. Internal comments never reach portal
// functions: the portal step reads comments only through a function that filters to `client` visibility. Change
// requests, tickets and documents add their targets when those modules arrive.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };
type Target = Doc<'comments'>['target'];

const target = v.object({ table: v.union(v.literal('deliverables'), v.literal('tasks')), id: v.string() });

async function resolveTarget(ctx: Ctx & Principal, subject: Target) {
  const record =
    subject.table === 'deliverables'
      ? await (async () => {
          const id = ctx.db.normalizeId('deliverables', subject.id);
          return id ? await ctx.db.get('deliverables', id) : null;
        })()
      : await (async () => {
          const id = ctx.db.normalizeId('tasks', subject.id);
          return id ? await ctx.db.get('tasks', id) : null;
        })();
  if (!record) throw notFound(subject.table === 'deliverables' ? 'Deliverable' : 'Task');
  const project = await visibleProject(ctx, ctx.principal, record.projectId);
  const title = 'title' in record ? record.title : '';
  const canPostToClient =
    subject.table === 'deliverables'
      ? ctx.principal.permissions.has('deliverables.manage.assigned')
      : ctx.principal.permissions.has('tasks.manage.all') || ctx.principal.permissions.has('tasks.manage.assigned');
  return { project, title, canPostToClient };
}

function linkFor(projectId: Id<'projects'>, subject: Target) {
  return subject.table === 'deliverables'
    ? `/projects/${projectId}/deliverables/${subject.id}`
    : `/projects/${projectId}/tasks?task=${subject.id}`;
}

export const list = teamQuery(null)({
  args: { target },
  handler: async (ctx, { target: subject }) => {
    const { canPostToClient } = await resolveTarget(ctx, subject);
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_target', (q) => q.eq('target.table', subject.table).eq('target.id', subject.id))
      .collect();
    return {
      canPostToClient,
      comments: await Promise.all(
        comments.map(async (comment) => {
          const author =
            comment.authorKind === 'team'
              ? await ctx.db.get('teamMembers', comment.authorId as Id<'teamMembers'>)
              : await ctx.db.get('contacts', comment.authorId as Id<'contacts'>);
          return {
            id: comment._id,
            body: comment.body,
            visibility: comment.visibility,
            authorKind: comment.authorKind,
            authorName: author?.name ?? 'Former member',
            createdAt: comment._creationTime,
            editedAt: comment.editedAt,
            canEdit: comment.authorKind === 'team' && comment.authorId === ctx.principal.member._id,
          };
        }),
      ),
    };
  },
});

async function mentions(ctx: Ctx, body: string, projectId: Id<'projects'>) {
  const ids: Id<'teamMembers'>[] = [];
  for (const raw of mentionedMemberIds(body)) {
    const id = ctx.db.normalizeId('teamMembers', raw);
    const member = id ? await ctx.db.get('teamMembers', id) : null;
    if (member?.status === 'active') ids.push(member._id);
  }
  // Only people who can see the project are told about it.
  const allowed: Id<'teamMembers'>[] = [];
  for (const id of ids) {
    const member = (await ctx.db.get('teamMembers', id))!;
    const role = await ctx.db.get('roles', member.roleId);
    const viewAll = role?.permissions.includes('projects.view.all');
    const onProject = await ctx.db
      .query('projectMembers')
      .withIndex('by_project_member', (q) => q.eq('projectId', projectId).eq('memberId', id))
      .unique();
    if (viewAll || onProject) allowed.push(id);
  }
  return allowed;
}

export const add = teamMutation(null)({
  args: { target, body: v.string(), visibility: v.union(v.literal('internal'), v.literal('client')) },
  handler: async (ctx, { target: subject, body: raw, visibility }) => {
    const { project, title, canPostToClient } = await resolveTarget(ctx, subject);
    if (visibility === 'client' && !canPostToClient) {
      throw projectError('projects.internalOnly', 'Your role can add internal comments only');
    }
    const body = text(raw, 'The comment', { required: true, max: 5000 })!;
    const mentioned = await mentions(ctx, body, project._id);
    const commentId = await ctx.db.insert('comments', {
      target: subject,
      projectId: project._id,
      clientId: project.clientId,
      body,
      mentions: mentioned,
      visibility,
      authorKind: 'team',
      authorId: ctx.principal.member._id,
    });
    const recipients = mentioned.filter((id) => id !== ctx.principal.member._id);
    const plain = plainMentions(body);
    await notifyTeamMembers(ctx, recipients, {
      event: 'mention',
      title: `${ctx.principal.member.name} mentioned you on ${title}`,
      body: plain.length > 200 ? `${plain.slice(0, 199)}…` : plain,
      link: linkFor(project._id, subject),
    });
    return commentId;
  },
});

async function ownComment(ctx: MutationCtx & Principal, commentId: Id<'comments'>) {
  const comment = await ctx.db.get('comments', commentId);
  if (!comment) throw notFound('Comment');
  await resolveTarget(ctx, comment.target);
  if (comment.authorKind !== 'team' || comment.authorId !== ctx.principal.member._id) {
    throw projectError('projects.notAuthor', 'Only the author can change this comment');
  }
  return comment;
}

export const update = teamMutation(null)({
  args: { commentId: v.id('comments'), body: v.string() },
  handler: async (ctx, { commentId, body }) => {
    await ownComment(ctx, commentId);
    await ctx.db.patch('comments', commentId, {
      body: text(body, 'The comment', { required: true, max: 5000 })!,
      editedAt: Date.now(),
    });
  },
});

export const remove = teamMutation(null)({
  args: { commentId: v.id('comments') },
  handler: async (ctx, { commentId }) => {
    await ownComment(ctx, commentId);
    await ctx.db.delete('comments', commentId);
  },
});
