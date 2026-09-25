import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { getClient, recordActivity, requirePermission, text } from './lib/crm';
import { recordUpload } from './lib/files';
import { teamMutation, teamQuery } from './lib/functions';
import { nextNumber } from './lib/numbering';
import { activeMembersWith, clientPortalContacts, notifyClientContacts, notifyTeamMembers } from './lib/notify';
import { authError, type TeamPrincipal } from './lib/principals';
import {
  canSeeTicket,
  dueTimesAfterPriorityChange,
  dueTimesFor,
  OPEN_STATUSES,
  policyForTicket,
  type Priority,
  resumeAfterPause,
  slaError,
  type TicketStatus,
} from './lib/sla';

// Tickets (09-support-and-sla.md, Tickets). What the client asked for, what the studio promised by when, and every
// message either side has sent about it. The promise is written onto the ticket when it is raised and only ever moves
// for a reason the spec names: the client was asked something, or the priority changed.

const priority = v.union(v.literal('p1'), v.literal('p2'), v.literal('p3'), v.literal('p4'));

const PRIORITY_LABEL: Record<Priority, string> = {
  p1: 'P1',
  p2: 'P2',
  p3: 'P3',
  p4: 'P4',
};

export async function getTicket(ctx: QueryCtx | MutationCtx, ticketId: Id<'tickets'>): Promise<Doc<'tickets'>> {
  const ticket = await ctx.db.get('tickets', ticketId);
  if (!ticket) throw slaError('tickets.notFound', 'Ticket not found');
  return ticket;
}

async function visibleTicket(
  ctx: (QueryCtx | MutationCtx) & { principal: TeamPrincipal },
  ticketId: Id<'tickets'>,
): Promise<Doc<'tickets'>> {
  const ticket = await getTicket(ctx, ticketId);
  if (!(await canSeeTicket(ctx, ctx.principal, ticket))) throw slaError('tickets.notFound', 'Ticket not found');
  return ticket;
}

function view(ticket: Doc<'tickets'>) {
  return {
    id: ticket._id,
    number: ticket.number,
    clientId: ticket.clientId,
    projectId: ticket.projectId,
    subject: ticket.subject,
    priority: ticket.priority,
    status: ticket.status,
    channel: ticket.channel,
    assigneeMemberId: ticket.assigneeMemberId,
    requesterContactId: ticket.requesterContactId,
    createdAt: ticket.createdAt,
    firstResponseDueAt: ticket.firstResponseDueAt,
    resolutionDueAt: ticket.resolutionDueAt,
    firstRespondedAt: ticket.firstRespondedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    pausedAt: ticket.pausedAt,
    // A ticket with no policy is not late, it was never promised a time.
    hasSla: ticket.slaPolicyId !== undefined,
  };
}

/** At most this many files on one message: enough for a few screenshots and a log, and no more. */
export const MAX_ATTACHMENTS = 5;

export const uploadArg = v.object({ storageId: v.id('_storage'), name: v.string(), contentType: v.string() });
export type Upload = { storageId: Id<'_storage'>; name: string; contentType: string };

/**
 * Saves the files that came with a message. A file attached to an internal note is marked internal, so the shared
 * portal rule in lib/files.ts keeps it inside the studio whatever else happens.
 *
 * A file that fails validation throws, which rolls the whole message back: a reply that quietly lost its screenshot
 * is worse than one that did not send, because only the second tells anybody.
 */
export async function attachUploads(
  ctx: MutationCtx,
  args: {
    messageId: Id<'ticketMessages'>;
    ticket: Pick<Doc<'tickets'>, 'clientId' | 'projectId'>;
    uploads: Upload[];
    visibility: Doc<'ticketMessages'>['visibility'];
    uploadedBy: { kind: 'team' | 'client'; id: string };
  },
): Promise<void> {
  if (args.uploads.length === 0) return;
  if (args.uploads.length > MAX_ATTACHMENTS) {
    throw slaError('tickets.tooManyFiles', `You can attach up to ${MAX_ATTACHMENTS} files to one message`);
  }
  const fileIds: Id<'files'>[] = [];
  for (const upload of args.uploads) {
    const saved = await recordUpload(ctx, {
      storageId: upload.storageId,
      name: upload.name,
      contentType: upload.contentType,
      context: 'document',
      owner: { table: 'ticketMessages', id: args.messageId },
      visibility: args.visibility === 'internal' ? 'internal' : 'client',
      clientId: args.ticket.clientId,
      projectId: args.ticket.projectId,
      uploadedBy: args.uploadedBy,
    });
    if (!saved.ok) throw slaError('tickets.badFile', `${upload.name}: ${saved.message}`);
    fileIds.push(saved.fileId);
  }
  await ctx.db.patch('ticketMessages', args.messageId, { fileIds });
}

/** Whether the last thing the client was told came from the studio, so a status change need not repeat it. */
async function lastPublicMessageIsFromUnbuilt(ctx: QueryCtx | MutationCtx, ticketId: Id<'tickets'>) {
  const messages = await ctx.db
    .query('ticketMessages')
    .withIndex('by_ticket', (q) => q.eq('ticketId', ticketId))
    .collect();
  const last = messages
    .filter((message) => message.visibility === 'public')
    .sort((a, b) => a.createdAt - b.createdAt)
    .at(-1);
  return last?.authorKind === 'team';
}

/** A message's attachments, by name: a thread should show what is attached without anybody having to open it. */
export async function filesOn(ctx: QueryCtx | MutationCtx, message: Doc<'ticketMessages'>) {
  const files = await Promise.all(message.fileIds.map((fileId) => ctx.db.get('files', fileId)));
  return files.filter((file) => file !== null).map((file) => ({ id: file._id, name: file.name }));
}

/** Everyone who should hear about a ticket moving: whoever holds it, and the project's manager. */
async function watchers(ctx: QueryCtx | MutationCtx, ticket: Doc<'tickets'>): Promise<Id<'teamMembers'>[]> {
  const ids: Id<'teamMembers'>[] = [];
  if (ticket.assigneeMemberId) ids.push(ticket.assigneeMemberId);
  if (ticket.projectId) {
    const project = await ctx.db.get('projects', ticket.projectId);
    if (project?.managerMemberId) ids.push(project.managerMemberId);
  }
  return ids;
}

/**
 * Raising a ticket. The client, the project and the priority decide what was promised, and the promise is worked out
 * once, here: a policy retired or a calendar edited later does not quietly move a date somebody was already given.
 */
export async function openTicket(
  ctx: MutationCtx,
  args: {
    clientId: Id<'clients'>;
    projectId?: Id<'projects'>;
    subject: string;
    description: string;
    priority: Priority;
    channel: Doc<'tickets'>['channel'];
    requesterContactId?: Id<'contacts'>;
    raisedByMemberId?: Id<'teamMembers'>;
    assigneeMemberId?: Id<'teamMembers'>;
    uploads?: Upload[];
    now?: number;
  },
): Promise<Id<'tickets'>> {
  const now = args.now ?? Date.now();
  const policy = await policyForTicket(ctx, { clientId: args.clientId, projectId: args.projectId });
  const due = await dueTimesFor(ctx, { from: now, priority: args.priority, policy });

  const ticketId = await ctx.db.insert('tickets', {
    number: await nextNumber(ctx, 'ticket'),
    clientId: args.clientId,
    projectId: args.projectId,
    slaPolicyId: policy?._id,
    priority: args.priority,
    status: 'new',
    subject: args.subject,
    channel: args.channel,
    requesterContactId: args.requesterContactId,
    raisedByMemberId: args.raisedByMemberId,
    assigneeMemberId: args.assigneeMemberId,
    createdAt: now,
    promisedFrom: now,
    ...due,
    pausedMinutes: 0,
  });

  // What they asked for is the first message, not a field of its own: the thread then reads in order from the start.
  const messageId = await ctx.db.insert('ticketMessages', {
    ticketId,
    visibility: 'public',
    body: args.description,
    authorKind: args.requesterContactId ? 'client' : args.raisedByMemberId ? 'team' : 'system',
    authorMemberId: args.raisedByMemberId,
    authorContactId: args.requesterContactId,
    fileIds: [],
    createdAt: now,
  });
  await attachUploads(ctx, {
    messageId,
    ticket: { clientId: args.clientId, projectId: args.projectId },
    uploads: args.uploads ?? [],
    visibility: 'public',
    uploadedBy: args.requesterContactId
      ? { kind: 'client', id: args.requesterContactId }
      : { kind: 'team', id: args.raisedByMemberId ?? 'system' },
  });

  const ticket = await getTicket(ctx, ticketId);
  await recordActivity(ctx, {
    subject: { table: 'tickets', id: ticketId },
    clientId: args.clientId,
    type: 'system',
    title: `${ticket.number} raised: ${args.subject}`,
    actor: args.requesterContactId
      ? { kind: 'client', id: args.requesterContactId }
      : args.raisedByMemberId
        ? { kind: 'team', id: args.raisedByMemberId }
        : { kind: 'system' },
    occurredAt: now,
    meta: { ticketId },
  });

  // Somebody has to pick it up: whoever it was given to, else everyone who can work tickets (14-platform.md).
  const tell = args.assigneeMemberId
    ? [args.assigneeMemberId, ...(await watchers(ctx, ticket))]
    : await activeMembersWith(ctx, 'tickets.manage');
  await notifyTeamMembers(ctx, tell, {
    event: 'ticket.created',
    title: `${PRIORITY_LABEL[args.priority]} ticket ${ticket.number}`,
    body: args.subject,
    link: `/support/tickets/${ticketId}`,
  });
  return ticketId;
}

export const create = teamMutation('tickets.manage')({
  args: {
    clientId: v.id('clients'),
    projectId: v.optional(v.id('projects')),
    subject: v.string(),
    description: v.string(),
    priority,
    requesterContactId: v.optional(v.id('contacts')),
    assigneeMemberId: v.optional(v.id('teamMembers')),
    uploads: v.optional(v.array(uploadArg)),
  },
  handler: async (ctx, args) => {
    await getClient(ctx, args.clientId);
    if (args.projectId) {
      const project = await ctx.db.get('projects', args.projectId);
      if (!project || project.clientId !== args.clientId) {
        throw slaError('tickets.invalid', 'That project does not belong to this client');
      }
    }
    if (args.requesterContactId) {
      const contact = await ctx.db.get('contacts', args.requesterContactId);
      if (!contact || contact.clientId !== args.clientId) {
        throw slaError('tickets.invalid', 'That contact does not belong to this client');
      }
    }
    return await openTicket(ctx, {
      ...args,
      subject: text(args.subject, 'Subject', { required: true, max: 200 })!,
      description: text(args.description, 'Description', { required: true, max: 10_000 })!,
      channel: 'team',
      raisedByMemberId: ctx.principal.member._id,
    });
  },
});

export const generateUploadUrl = teamMutation('tickets.manage')({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const list = teamQuery(null)({
  args: {
    status: v.optional(v.union(v.literal('open'), v.literal('all'), v.literal('mine'))),
    clientId: v.optional(v.id('clients')),
    projectId: v.optional(v.id('projects')),
  },
  handler: async (ctx, { status = 'open', clientId, projectId }) => {
    if (!ctx.can('tickets.view.all')) requirePermission(ctx.principal, 'tickets.view.assigned');
    const rows = clientId
      ? await ctx.db
          .query('tickets')
          .withIndex('by_client', (q) => q.eq('clientId', clientId))
          .collect()
      : projectId
        ? await ctx.db
            .query('tickets')
            .withIndex('by_project', (q) => q.eq('projectId', projectId))
            .collect()
        : await ctx.db.query('tickets').take(1000);

    const open = new Set(OPEN_STATUSES);
    const visible: Doc<'tickets'>[] = [];
    for (const ticket of rows) {
      if (status === 'open' && !open.has(ticket.status)) continue;
      if (status === 'mine' && ticket.assigneeMemberId !== ctx.principal.member._id) continue;
      if (await canSeeTicket(ctx, ctx.principal, ticket)) visible.push(ticket);
    }
    return visible.map(view).sort((a, b) => b.number.localeCompare(a.number));
  },
});

export const get = teamQuery(null)({
  args: { ticketId: v.id('tickets') },
  handler: async (ctx, { ticketId }) => {
    if (!ctx.can('tickets.view.all')) requirePermission(ctx.principal, 'tickets.view.assigned');
    const ticket = await visibleTicket(ctx, ticketId);
    const messages = await ctx.db
      .query('ticketMessages')
      .withIndex('by_ticket', (q) => q.eq('ticketId', ticketId))
      .collect();
    const client = await ctx.db.get('clients', ticket.clientId);
    const policy = ticket.slaPolicyId ? await ctx.db.get('slaPolicies', ticket.slaPolicyId) : null;
    return {
      ...view(ticket),
      clientName: client?.displayName ?? 'Unknown client',
      slaPolicyName: policy?.name,
      messages: await Promise.all(
        messages
          .sort((a, b) => a.createdAt - b.createdAt)
          .map(async (message) => ({
            id: message._id,
            visibility: message.visibility,
            body: message.body,
            authorKind: message.authorKind,
            authorMemberId: message.authorMemberId,
            authorContactId: message.authorContactId,
            files: await filesOn(ctx, message),
            createdAt: message.createdAt,
          })),
      ),
    };
  },
});

/**
 * A reply from the studio. The first public one stops the first response clock (09-support-and-sla.md, Timers); an
 * internal note never does, because nobody outside the studio has heard anything.
 */
export const reply = teamMutation('tickets.manage')({
  args: {
    ticketId: v.id('tickets'),
    body: v.string(),
    visibility: v.union(v.literal('public'), v.literal('internal')),
    uploads: v.optional(v.array(uploadArg)),
  },
  handler: async (ctx, { ticketId, body, visibility, uploads }) => {
    const ticket = await visibleTicket(ctx, ticketId);
    if (ticket.status === 'closed') throw slaError('tickets.closed', 'This ticket is closed; raise a new one');
    const now = Date.now();
    const said = text(body, 'Message', { required: true, max: 10_000 })!;

    const messageId = await ctx.db.insert('ticketMessages', {
      ticketId,
      visibility,
      body: said,
      authorKind: 'team',
      authorMemberId: ctx.principal.member._id,
      fileIds: [],
      createdAt: now,
    });
    await attachUploads(ctx, {
      messageId,
      ticket,
      uploads: uploads ?? [],
      visibility,
      uploadedBy: { kind: 'team', id: ctx.principal.member._id },
    });

    if (visibility === 'public') {
      const patch: Partial<Doc<'tickets'>> = {};
      if (ticket.firstRespondedAt === undefined) patch.firstRespondedAt = now;
      // Answering a ticket that was waiting on the client puts the ball back in the studio's court.
      if (ticket.status === 'pending_client') {
        Object.assign(patch, await resumeAfterPause(ctx, ticket, now), { pausedAt: undefined, status: 'open' });
      } else if (ticket.status === 'new') {
        patch.status = 'open';
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch('tickets', ticketId, patch);
      // The number leads, as on every other ticket notification either side gets, then the subject so they know which
      // one it is, and the body carries what was actually said: otherwise every reply on a ticket reads identically
      // and tells them nothing.
      await notifyClientContacts(ctx, await clientPortalContacts(ctx, ticket.clientId), {
        event: 'ticket.reply',
        title: `${ticket.number}: Unbuilt replied about ${ticket.subject}`,
        body: said.slice(0, 140),
        link: `/tickets/${ticketId}`,
      });
    }
    return { firstResponse: visibility === 'public' && ticket.firstRespondedAt === undefined };
  },
});

const status = v.union(v.literal('open'), v.literal('pending_client'), v.literal('resolved'), v.literal('closed'));

export const setStatus = teamMutation('tickets.manage')({
  args: { ticketId: v.id('tickets'), status },
  handler: async (ctx, { ticketId, status: next }) => {
    const ticket = await visibleTicket(ctx, ticketId);
    if (ticket.status === next) return;
    if (ticket.status === 'closed') throw slaError('tickets.closed', 'This ticket is closed; raise a new one');
    const now = Date.now();
    const patch: Partial<Doc<'tickets'>> = { status: next as TicketStatus };

    if (ticket.status === 'pending_client') {
      Object.assign(patch, await resumeAfterPause(ctx, ticket, now), { pausedAt: undefined });
    }
    if (next === 'pending_client') patch.pausedAt = now;
    if (next === 'resolved') patch.resolvedAt = now;
    if (next === 'closed') patch.closedAt = now;
    // Reopening by hand: the ticket is live again, so it is no longer resolved.
    if (next === 'open' && ticket.status === 'resolved') patch.resolvedAt = undefined;

    await ctx.db.patch('tickets', ticketId, patch);
    await recordActivity(ctx, {
      subject: { table: 'tickets', id: ticketId },
      clientId: ticket.clientId,
      type: 'system',
      title: `${ticket.number} is ${next.replace('_', ' ')}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      occurredAt: now,
      meta: { ticketId },
    });
    if (next === 'resolved') {
      await notifyClientContacts(ctx, await clientPortalContacts(ctx, ticket.clientId), {
        event: 'ticket.resolved',
        title: `${ticket.number} is resolved`,
        body: `${ticket.subject}. Reply within 7 days if it is not right.`,
        link: `/tickets/${ticketId}`,
      });
    }
    // Being waited on is something a client has to be told, or the ticket goes quiet on both sides: their screen says
    // it is with them, and the studio's clock has stopped. Skipped when the studio has just replied, since that reply
    // is itself the telling, and two notifications for one action is noise.
    if (next === 'pending_client' && !(await lastPublicMessageIsFromUnbuilt(ctx, ticketId))) {
      await notifyClientContacts(ctx, await clientPortalContacts(ctx, ticket.clientId), {
        event: 'ticket.pending_client',
        title: `${ticket.number}: Unbuilt is waiting on you`,
        body: `${ticket.subject}. Open it to see what they need.`,
        link: `/tickets/${ticketId}`,
      });
    }
  },
});

export const assign = teamMutation('tickets.manage')({
  args: { ticketId: v.id('tickets'), assigneeMemberId: v.optional(v.id('teamMembers')) },
  handler: async (ctx, { ticketId, assigneeMemberId }) => {
    const ticket = await visibleTicket(ctx, ticketId);
    if (assigneeMemberId) {
      const member = await ctx.db.get('teamMembers', assigneeMemberId);
      if (!member || member.status !== 'active') throw slaError('tickets.invalid', 'That team member is not active');
    }
    await ctx.db.patch('tickets', ticketId, { assigneeMemberId });
    if (assigneeMemberId && assigneeMemberId !== ticket.assigneeMemberId) {
      await notifyTeamMembers(ctx, [assigneeMemberId], {
        event: 'ticket.assigned',
        title: `${ticket.number} is yours`,
        body: ticket.subject,
        link: `/support/tickets/${ticketId}`,
      });
    }
  },
});

/** Changing the priority re-runs the promise; see `dueTimesAfterPriorityChange` for what that means and why. */
export const setPriority = teamMutation('tickets.manage')({
  args: { ticketId: v.id('tickets'), priority },
  handler: async (ctx, { ticketId, priority: next }) => {
    const ticket = await visibleTicket(ctx, ticketId);
    if (ticket.priority === next) return;
    const due = await dueTimesAfterPriorityChange(ctx, ticket, next);
    await ctx.db.patch('tickets', ticketId, { priority: next, ...due });
    await recordActivity(ctx, {
      subject: { table: 'tickets', id: ticketId },
      clientId: ticket.clientId,
      type: 'system',
      title: `${ticket.number} moved from ${PRIORITY_LABEL[ticket.priority]} to ${PRIORITY_LABEL[next]}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { ticketId },
    });
  },
});

export const forClient = teamQuery(null)({
  args: { clientId: v.id('clients') },
  handler: async (ctx, { clientId }) => {
    if (!ctx.can('tickets.view.all') && !ctx.can('tickets.view.assigned')) {
      throw authError('auth.forbidden', 'Your role cannot view tickets');
    }
    const rows = await ctx.db
      .query('tickets')
      .withIndex('by_client', (q) => q.eq('clientId', clientId))
      .collect();
    const visible: Doc<'tickets'>[] = [];
    for (const ticket of rows) if (await canSeeTicket(ctx, ctx.principal, ticket)) visible.push(ticket);
    return visible.map(view).sort((a, b) => b.number.localeCompare(a.number));
  },
});
