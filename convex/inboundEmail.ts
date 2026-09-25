import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, publicHttp } from './lib/functions';
import { normalise, ticketNumberIn, withoutQuotedReply } from './lib/inboundEmail';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { openTicket, recordClientReply } from './tickets';

// POST /webhooks/inbound-email (14-platform.md, Webhooks): mail sent to support@ becomes a ticket, or a message on the
// ticket it is replying to. Verify, store the event once, then answer quickly, as with every other webhook.

/**
 * A shared secret, which 14-platform.md allows in place of a provider signature. The studio has not chosen an inbound
 * provider yet; when it does, its own signature replaces this, and nothing downstream changes.
 */
function authorised(request: Request): boolean {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret || secret.length < 32) return false;
  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (offered.length !== secret.length) return false;
  let difference = 0;
  for (let i = 0; i < secret.length; i++) difference |= offered.charCodeAt(i) ^ secret.charCodeAt(i);
  return difference === 0;
}

export const inboundEmailWebhook = publicHttp(async (ctx, request) => {
  if (!authorised(request)) return new Response('Unauthorised', { status: 401 });
  const raw = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return new Response('Bad body', { status: 400 });
  }
  const email = normalise(payload);
  // Nothing anybody could act on. Answered 200 so the provider stops resending it.
  if (!email) return new Response('ignored', { status: 200 });

  const fresh = await ctx.runMutation(internal.inboundEmail.recordEvent, {
    messageId: email.messageId,
    payload: raw,
  });
  if (fresh) await ctx.scheduler.runAfter(0, internal.inboundEmail.deliver, { email });
  return new Response('ok', { status: 200 });
});

/** Stores the event once. Returns false when this message has already been seen, so a resend changes nothing. */
export const recordEvent = internalMutation({
  args: { messageId: v.string(), payload: v.string() },
  handler: async (ctx, { messageId, payload }): Promise<boolean> => {
    const seen = await ctx.db
      .query('webhookEvents')
      .withIndex('by_provider_event', (q) => q.eq('provider', 'inbound_email').eq('eventId', messageId))
      .first();
    if (seen) return false;
    await ctx.db.insert('webhookEvents', {
      provider: 'inbound_email',
      eventId: messageId,
      type: 'email.inbound',
      receivedAt: Date.now(),
      status: 'received',
      attempts: 0,
      payload,
    });
    return true;
  },
});

const emailArg = v.object({
  messageId: v.string(),
  from: v.string(),
  fromName: v.optional(v.string()),
  subject: v.string(),
  body: v.string(),
});

/**
 * Turning an email into support. A reply carrying a ticket number joins that ticket, through the same path a portal
 * reply takes; anything else opens a new one. An address the studio does not know still gets a ticket, flagged for
 * somebody to say who it is from — silence is the one thing a support address must never answer with.
 */
export const deliver = internalMutation({
  args: { email: emailArg },
  handler: async (ctx, { email }) => {
    const now = Date.now();
    const said = withoutQuotedReply(email.body);

    const contact = (
      await ctx.db
        .query('contacts')
        .withIndex('by_email', (q) => q.eq('email', email.from))
        .collect()
    ).find((row) => row.status === 'active');

    const number = ticketNumberIn(email.subject);
    const existing = number
      ? await ctx.db
          .query('tickets')
          .withIndex('by_number', (q) => q.eq('number', number))
          .first()
      : null;

    // A number in a subject line is a claim, not a credential: it only threads onto a ticket the sender has a right
    // to. Their own client's, or — for somebody still waiting on triage — the one they wrote in on before.
    const theirs =
      existing &&
      (contact
        ? existing.clientId === contact.clientId
        : existing.clientId === undefined && existing.fromEmail === email.from);

    if (existing && theirs) {
      return await recordClientReply(ctx, {
        ticket: existing,
        body: said,
        contactId: contact?._id,
        authorName: contact?.name ?? email.fromName ?? email.from,
        channel: 'email',
        now,
      });
    }

    const ticketId = await openTicket(ctx, {
      clientId: contact?.clientId,
      subject: email.subject,
      description: said,
      // An email says nothing about how urgent it is, so it starts where a question starts and is raised by hand.
      priority: 'p3',
      channel: 'email',
      requesterContactId: contact?._id,
      fromEmail: contact ? undefined : email.from,
      needsTriage: contact ? undefined : true,
      now,
    });
    if (!contact) {
      await notifyTeamMembers(ctx, await activeMembersWith(ctx, 'tickets.manage'), {
        event: 'ticket.triage',
        title: 'Email from somebody the studio does not know',
        body: `${email.from}: ${email.subject}`,
        link: `/support/tickets/${ticketId}`,
      });
    }
    return { ticketId, reopened: false, isNew: true };
  },
});
