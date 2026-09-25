import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { text } from './lib/crm';
import { portalMutation, portalQuery } from './lib/functions';
import { type ClientPrincipal } from './lib/principals';
import { slaError, withinReopenWindow } from './lib/sla';
import { filesOn, openTicket, recordClientReply, uploadArg } from './tickets';

// Support in the client portal (12-client-portal.md, Support). A client raises a ticket, reads the thread and replies.
// Internal notes are absent from every response here, and so is anything the studio wrote to itself about the SLA:
// the client is told what they asked and what they were told, and nothing about how the studio is scored on it.

const priority = v.union(v.literal('p1'), v.literal('p2'), v.literal('p3'), v.literal('p4'));

async function theirTicket(
  ctx: QueryCtx | MutationCtx,
  ticketId: Id<'tickets'>,
  clientId: Id<'clients'>,
): Promise<Doc<'tickets'> | null> {
  const ticket = await ctx.db.get('tickets', ticketId);
  // Another client's ticket is simply not there.
  return ticket && ticket.clientId === clientId ? ticket : null;
}

/**
 * What a client is told about where their ticket stands. The studio's own statuses would mislead: `new` and `open`
 * both mean Unbuilt has it, and neither is the client's business to distinguish.
 */
function clientStatus(ticket: Doc<'tickets'>): 'with_unbuilt' | 'with_you' | 'resolved' | 'closed' {
  switch (ticket.status) {
    case 'pending_client':
      return 'with_you';
    case 'resolved':
      return 'resolved';
    case 'closed':
      return 'closed';
    default:
      return 'with_unbuilt';
  }
}

function view(ticket: Doc<'tickets'>, now: number) {
  return {
    id: ticket._id,
    number: ticket.number,
    subject: ticket.subject,
    priority: ticket.priority,
    status: clientStatus(ticket),
    projectId: ticket.projectId,
    createdAt: ticket.createdAt,
    resolvedAt: ticket.resolvedAt,
    // Whether a reply would reopen this one or start a new ticket, so the screen can say which before they type.
    canReopen: ticket.status === 'resolved' && withinReopenWindow(ticket, now),
  };
}

export const list = portalQuery('portal.tickets.view')({
  args: {},
  handler: async (ctx) => {
    const principal = ctx.principal as ClientPrincipal;
    const now = Date.now();
    const tickets = await ctx.db
      .query('tickets')
      .withIndex('by_client', (q) => q.eq('clientId', principal.clientId))
      .collect();
    // The company's tickets, not only this person's: a colleague picking up somebody's report is the normal case.
    return tickets.map((ticket) => view(ticket, now)).sort((a, b) => b.number.localeCompare(a.number));
  },
});

export const get = portalQuery('portal.tickets.view')({
  args: { ticketId: v.id('tickets') },
  handler: async (ctx, { ticketId }) => {
    const principal = ctx.principal as ClientPrincipal;
    const ticket = await theirTicket(ctx, ticketId, principal.clientId);
    if (!ticket) return null;
    const messages = await ctx.db
      .query('ticketMessages')
      .withIndex('by_ticket', (q) => q.eq('ticketId', ticketId))
      .collect();
    const project = ticket.projectId ? await ctx.db.get('projects', ticket.projectId) : null;
    return {
      ...view(ticket, Date.now()),
      projectName: project?.name,
      messages: await Promise.all(
        messages
          // Internal notes never leave the studio (12-client-portal.md, Rules).
          .filter((message) => message.visibility === 'public')
          .sort((a, b) => a.createdAt - b.createdAt)
          .map(async (message) => ({
            id: message._id,
            body: message.body,
            fromUnbuilt: message.authorKind !== 'client',
            authorContactId: message.authorContactId,
            files: await filesOn(ctx, message),
            createdAt: message.createdAt,
          })),
      ),
    };
  },
});

export const create = portalMutation('portal.tickets.create')({
  args: {
    subject: v.string(),
    description: v.string(),
    priority,
    projectId: v.optional(v.id('projects')),
    uploads: v.optional(v.array(uploadArg)),
  },
  handler: async (ctx, args) => {
    const principal = ctx.principal as ClientPrincipal;
    if (args.projectId) {
      const project = await ctx.db.get('projects', args.projectId);
      if (!project || project.clientId !== principal.clientId) {
        throw slaError('tickets.notFound', 'That project is not yours');
      }
    }
    return await openTicket(ctx, {
      clientId: principal.clientId,
      projectId: args.projectId,
      subject: text(args.subject, 'Subject', { required: true, max: 200 })!,
      description: text(args.description, 'What is wrong', { required: true, max: 10_000 })!,
      priority: args.priority,
      channel: 'portal',
      requesterContactId: principal.contact._id,
      uploads: args.uploads,
    });
  },
});

/** Somewhere to put the bytes before the message that carries them exists. */
export const generateUploadUrl = portalMutation('portal.files.upload')({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const reply = portalMutation('portal.tickets.view')({
  args: { ticketId: v.id('tickets'), body: v.string(), uploads: v.optional(v.array(uploadArg)) },
  handler: async (ctx, { ticketId, body, uploads }) => {
    const principal = ctx.principal as ClientPrincipal;
    const ticket = await theirTicket(ctx, ticketId, principal.clientId);
    if (!ticket) throw slaError('tickets.notFound', 'That ticket is not here');
    // The same path an emailed reply takes, so answering in the portal and answering by email cannot drift apart.
    return await recordClientReply(ctx, {
      ticket,
      body: text(body, 'Message', { required: true, max: 10_000 })!,
      contactId: principal.contact._id,
      authorName: principal.contact.name,
      channel: 'portal',
      uploads,
      now: Date.now(),
    });
  },
});
