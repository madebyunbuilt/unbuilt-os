import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, internalMutation, publicHttp } from './lib/functions';
import { normalise, readableBody, ticketNumberIn, withoutQuotedReply } from './lib/inboundEmail';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { openTicket, recordClientReply } from './tickets';

// POST /webhooks/inbound-email (14-platform.md, Webhooks): mail sent to support@ becomes a ticket, or a message on the
// ticket it is replying to. Verify, store the event once, then answer quickly, as with every other webhook.

/** Constant-time compare, so a wrong secret tells an attacker nothing about how wrong it was. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

const SVIX_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Resend signs inbound mail the way it signs its delivery webhook: Svix headers over `id.timestamp.body`, with the
 * secret base64 after a `whsec_` prefix (14-platform.md, Webhooks).
 */
async function svixVerified(request: Request, raw: string, now: number): Promise<boolean> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const offered = request.headers.get('svix-signature');
  if (!id || !timestamp || !offered || !/^\d+$/.test(timestamp)) return false;
  // A signature is only good for a few minutes, so a captured request cannot be replayed later.
  if (Math.abs(now - Number(timestamp) * 1000) > SVIX_TOLERANCE_MS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (character) => character.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  // The header carries every signature Svix currently accepts, space separated and each prefixed with its version.
  return offered.split(' ').some((part) => sameSecret(part.replace(/^v1,/, ''), expected));
}

/**
 * A shared secret, which 14-platform.md allows in place of a provider signature. It is how the studio can try the
 * endpoint before any provider is pointed at it, and it stops working the moment a real signing secret is configured,
 * so turning the provider on closes this door rather than leaving two.
 */
function bearerVerified(request: Request): boolean {
  if (process.env.RESEND_WEBHOOK_SECRET) return false;
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret || secret.length < 32) return false;
  return sameSecret(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '', secret);
}

export const inboundEmailWebhook = publicHttp(async (ctx, request) => {
  const raw = await request.text();
  if (!(await svixVerified(request, raw, Date.now())) && !bearerVerified(request)) {
    return new Response('Unauthorised', { status: 401 });
  }

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
  // The body is fetched before the ticket is written, which needs an action rather than a mutation.
  if (fresh) await ctx.scheduler.runAfter(0, internal.inboundEmail.collect, { email });
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
  emailId: v.optional(v.string()),
  messageId: v.string(),
  from: v.string(),
  fromName: v.optional(v.string()),
  subject: v.string(),
  body: v.string(),
});

/**
 * Resend's webhook says an email arrived and nothing about what it says (studio, 2026-09-25), so the content is
 * fetched here before the ticket is written.
 *
 * A fetch that fails does not lose the email: the ticket is raised anyway, saying plainly that the body could not be
 * read and where to find it. A person waiting for support is worse served by silence than by a short ticket.
 */
export const collect = internalAction({
  args: { email: emailArg },
  handler: async (ctx, { email }): Promise<void> => {
    let body = email.body;
    if (!body && email.emailId) {
      body = (await fetchBody(email.emailId)) ?? `(Unbuilt could not read this email. Resend id ${email.emailId}.)`;
    }
    await ctx.runMutation(internal.inboundEmail.deliver, { email: { ...email, body } });
  },
});

/** The text of a received email, or null when Resend will not give it to us. */
async function fetchBody(emailId: string): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  // Received mail has its own path; /emails/{id} is for what the studio sent and answers 404 here. A user agent is
  // sent because the API sits behind Cloudflare, which turns an anonymous client away before Resend ever sees it.
  const response = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { authorization: `Bearer ${apiKey}`, 'user-agent': 'unbuilt-os' },
  });
  if (!response.ok) return null;
  return readableBody((await response.json()) as { text?: string; html?: string });
}

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
