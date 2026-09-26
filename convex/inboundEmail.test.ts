import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { normalise, parseAddress, ticketNumberIn, withoutQuotedReply } from './lib/inboundEmail';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Mail sent to support@ (09-support-and-sla.md, Tickets). A support address that swallows an email is worse than one
// that does not exist, so everything that arrives ends up somewhere a person will look.

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

const lagos = (iso: string) => Date.parse(`${iso}+01:00`);

/** Moves the clock, keeping the signed-in sessions alive: a team session idles out after twelve hours. */
async function travelTo(iso: string) {
  vi.setSystemTime(lagos(iso));
  const now = Date.now();
  await t.run(async (ctx) => {
    for (const { sessionId, authUserId } of [pm, ada]) {
      const row = await ctx.db
        .query('sessionActivity')
        .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
        .unique();
      if (row) await ctx.db.patch('sessionActivity', row._id, { lastActiveAt: now });
      else await ctx.db.insert('sessionActivity', { sessionId, authUserId, lastActiveAt: now });
    }
  });
}

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let ada: Awaited<ReturnType<typeof createClientUser>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(lagos('2026-10-12T10:00:00'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  await t.run(async (ctx) => {
    const policy = await ctx.db
      .query('slaPolicies')
      .withIndex('by_name', (q) => q.eq('name', 'Standard'))
      .first();
    await ctx.db.patch('clients', ada.clientId, { slaPolicyId: policy!._id });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const arrive = async (email: Partial<Parameters<typeof deliverArgs>[0]> = {}) =>
  await t.mutation(internal.inboundEmail.deliver, { email: deliverArgs(email) });

function deliverArgs(
  overrides: Partial<{ messageId: string; from: string; fromName: string; subject: string; body: string }>,
) {
  return {
    messageId: `m-${Math.random()}`,
    from: 'ada@glossup.com',
    subject: 'Checkout is down',
    body: 'Nobody can pay.',
    ...overrides,
  };
}

const tickets = async () => await t.run((ctx) => ctx.db.query('tickets').collect());

describe('reading what arrived', () => {
  it('takes an address out of a header however it is written', () => {
    expect(parseAddress('Ada Obi <Ada@Glossup.com>')).toEqual({ email: 'ada@glossup.com', name: 'Ada Obi' });
    expect(parseAddress('ada@glossup.com')).toEqual({ email: 'ada@glossup.com' });
    expect(parseAddress('"Obi, Ada" <ada@glossup.com>, bola@qravit.com')).toMatchObject({
      email: 'ada@glossup.com',
    });
    expect(parseAddress('not an address')).toBeNull();
  });

  it('reads the fields whatever the provider calls them', () => {
    expect(normalise({ from: 'ada@glossup.com', subject: 'Help', text: 'It broke' })).toMatchObject({
      from: 'ada@glossup.com',
      subject: 'Help',
      body: 'It broke',
    });
    // Postmark's names, nested the way Resend nests them.
    expect(normalise({ data: { From: 'ada@glossup.com', Subject: 'Help', TextBody: 'It broke' } })).toMatchObject({
      subject: 'Help',
      body: 'It broke',
    });
  });

  it('refuses what nobody could act on', () => {
    expect(normalise({ subject: 'Help', text: 'It broke' })).toBeNull();
    expect(normalise({ from: 'ada@glossup.com' })).toBeNull();
    expect(normalise('not an object')).toBeNull();
  });

  it('finds the ticket number in a subject however it has been mangled', () => {
    expect(ticketNumberIn('Re: [UNB-TKT-0007] Checkout is down')).toBe('UNB-TKT-0007');
    expect(ticketNumberIn('Fwd: re: unb-tkt-0007 still broken')).toBe('UNB-TKT-0007');
    expect(ticketNumberIn('Checkout is down')).toBeNull();
  });

  it('keeps what they wrote this time, not the thread underneath it', () => {
    expect(withoutQuotedReply('Still broken.\n\nOn Monday Unbuilt wrote:\n> We fixed it')).toBe('Still broken.');
    expect(withoutQuotedReply('Still broken.\n\n> We fixed it')).toBe('Still broken.');
    // Nothing but quoted text: better to keep it than to store an empty message.
    expect(withoutQuotedReply('> only a quote')).toBe('> only a quote');
  });
});

describe('an email from somebody the studio knows', () => {
  it('opens a ticket against their client, with what they promised', async () => {
    const { ticketId } = await arrive();
    const ticket = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!;
    expect(ticket).toMatchObject({
      clientId: ada.clientId,
      requesterContactId: ada.contactId,
      channel: 'email',
      // Email says nothing about urgency, so it starts as a question.
      priority: 'p3',
      subject: 'Checkout is down',
    });
    expect(ticket).not.toHaveProperty('needsTriage');
    // A P3 has one business day to be answered: raised at 10:00 on a Monday, due 10:00 on the Tuesday.
    expect(ticket.firstResponseDueAt).toBe(lagos('2026-10-13T10:00:00'));
    expect(await pm.as.query(api.tickets.get, { ticketId })).toMatchObject({ clientName: 'Glossup' });
  });

  it('threads a reply onto the ticket its subject names', async () => {
    const { ticketId } = await arrive();
    const number = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!.number;
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Which card?', visibility: 'public' });
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'pending_client' });

    const result = await arrive({ subject: `Re: [${number}] Checkout is down`, body: 'A Visa card.' });
    expect(result).toMatchObject({ ticketId, isNew: false });
    expect(await tickets()).toHaveLength(1);
    // Their answer starts the studio's clock again, exactly as a portal reply would.
    expect((await t.run((ctx) => ctx.db.get('tickets', ticketId)))!.status).toBe('open');
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    expect(ticket.messages.map((m) => m.body)).toEqual(['Nobody can pay.', 'Which card?', 'A Visa card.']);
  });

  it('will not let a number in a subject line reach another client’s ticket', async () => {
    const { ticketId } = await arrive();
    const number = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!.number;
    // Somebody else quoting the number gets their own ticket, not a seat at this one.
    const result = await arrive({ from: 'stranger@example.com', subject: `Re: [${number}] give me this` });
    expect(result.ticketId).not.toBe(ticketId);
    expect((await t.run((ctx) => ctx.db.get('tickets', result.ticketId)))!.needsTriage).toBe(true);
  });

  it('opens a new ticket when the old one was closed, rather than talking into a closed thread', async () => {
    const { ticketId } = await arrive();
    const number = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!.number;
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'closed' });
    const result = await arrive({ subject: `Re: ${number} it is back`, body: 'It is back.' });
    expect(result.isNew).toBe(true);
    expect((await t.run((ctx) => ctx.db.get('tickets', result.ticketId)))!.reopenedFromTicketId).toBe(ticketId);
  });
});

describe('an email from somebody the studio does not know', () => {
  it('still becomes a ticket, flagged for somebody to say who it is from', async () => {
    const { ticketId } = await arrive({ from: 'nobody@example.com', subject: 'Are you taking work?' });
    const ticket = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!;
    expect(ticket).toMatchObject({ needsTriage: true, fromEmail: 'nobody@example.com', channel: 'email' });
    // No client at all: there is nobody to attach it to until somebody says who wrote in.
    expect(ticket).not.toHaveProperty('clientId');
    // Nothing was promised, because there is no client and so no policy.
    expect(ticket.firstResponseDueAt).toBeUndefined();
    expect((await pm.as.query(api.tickets.get, { ticketId })).clientName).toBeUndefined();
  });

  it('tells the people who work tickets that it needs somebody', async () => {
    await arrive({ from: 'nobody@example.com' });
    const told = (await t.run((ctx) => ctx.db.query('notifications').collect())).filter(
      (n) => n.event === 'ticket.triage',
    );
    expect(told.map((n) => n.recipientId)).toContain(pm.memberId);
    expect(told[0].body).toContain('nobody@example.com');
  });

  it('reaches no client at all while it waits', async () => {
    await arrive({ from: 'nobody@example.com' });
    expect(await ada.as.query(api.portalTickets.list, {})).toEqual([]);
  });

  it('lets them carry on the thread they started', async () => {
    const { ticketId } = await arrive({ from: 'nobody@example.com' });
    const number = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!.number;
    const result = await arrive({ from: 'nobody@example.com', subject: `Re: ${number}`, body: 'Anybody there?' });
    expect(result).toMatchObject({ ticketId, isNew: false });
  });

  it('is promised from when the email arrived once somebody says whose it is', async () => {
    const { ticketId } = await arrive({ from: 'nobody@example.com' });
    // Picked up two days later. The promise runs from the email, not from the moment somebody got round to it.
    await travelTo('2026-10-14T10:00:00');
    await pm.as.mutation(api.tickets.triage, { ticketId, clientId: ada.clientId, requesterContactId: ada.contactId });

    const ticket = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!;
    expect(ticket.clientId).toBe(ada.clientId);
    expect(ticket).not.toHaveProperty('needsTriage');
    expect(ticket.firstResponseDueAt).toBe(lagos('2026-10-13T10:00:00'));
    // Which means it is already late, and the studio is told so rather than being handed a fresh day.
    expect(ticket.firstResponseDueAt! < Date.now()).toBe(true);
    // And it is the client's ticket now.
    expect(await ada.as.query(api.portalTickets.list, {})).toHaveLength(1);
  });

  it('refuses a contact who belongs to somebody else, and a ticket that needs no triage', async () => {
    const other = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
    const { ticketId } = await arrive({ from: 'nobody@example.com' });
    await expectCode(
      pm.as.mutation(api.tickets.triage, {
        ticketId,
        clientId: ada.clientId,
        requesterContactId: other.contactId,
      }),
      'tickets.invalid',
    );
    const known = await arrive();
    await expectCode(
      pm.as.mutation(api.tickets.triage, { ticketId: known.ticketId, clientId: ada.clientId }),
      'tickets.invalid',
    );
  });
});

describe('an email whose body has to be fetched', () => {
  it('raises the ticket anyway when Resend will not give us the words', async () => {
    // Resend's webhook carries an id and no body; a fetch that fails must not swallow somebody's request for help.
    const { ticketId } = await arrive({
      body: '(Unbuilt could not read this email. Resend id abc-123.)',
      subject: 'Payments are failing',
    });
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    expect(ticket.subject).toBe('Payments are failing');
    expect(ticket.messages[0].body).toContain('could not read this email');
    expect(ticket.messages[0].body).toContain('abc-123');
  });

  it('reads an email from somebody unknown as theirs, never as the studio’s own words', async () => {
    const { ticketId } = await arrive({ from: 'nobody@example.com' });
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    // A system message would read as Unbuilt in the portal once the ticket is placed.
    expect(ticket.messages[0].authorKind).toBe('client');
  });

  it('keeps an id with no subject or body, since the words come later', () => {
    expect(normalise({ type: 'email.received', data: { from: 'ada@glossup.com', email_id: 'abc-123' } })).toMatchObject(
      { emailId: 'abc-123', from: 'ada@glossup.com' },
    );
  });
});

describe('the webhook itself', () => {
  it('stores a message once, however many times it is delivered', async () => {
    const first = await t.mutation(internal.inboundEmail.recordEvent, { messageId: 'abc', payload: '{}' });
    const second = await t.mutation(internal.inboundEmail.recordEvent, { messageId: 'abc', payload: '{}' });
    expect([first, second]).toEqual([true, false]);
  });
});

describe('who is allowed to post mail in', () => {
  const secret = 'a-shared-secret-long-enough-to-be-real';
  const post = async (headers: Record<string, string>, body = '{}') =>
    await t.fetch('/webhooks/inbound-email', { method: 'POST', headers, body });

  afterEach(() => vi.unstubAllEnvs());

  it('turns away anything unsigned', async () => {
    vi.stubEnv('INBOUND_EMAIL_SECRET', secret);
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: 'Bearer wrong-secret-of-the-same-length!!' })).status).toBe(401);
  });

  it('takes the shared secret while no provider is wired up', async () => {
    vi.stubEnv('INBOUND_EMAIL_SECRET', secret);
    const body = JSON.stringify({ messageId: 'a', from: 'ada@glossup.com', subject: 'Hi', text: 'Hello' });
    expect((await post({ authorization: `Bearer ${secret}` }, body)).status).toBe(200);
  });

  it('stops taking it the moment a real signing secret exists', async () => {
    vi.stubEnv('INBOUND_EMAIL_SECRET', secret);
    // Turning the provider on closes the back door rather than leaving two ways in.
    vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_c2VjcmV0LXRoaW5n');
    expect((await post({ authorization: `Bearer ${secret}` })).status).toBe(401);
  });

  it('takes a correctly signed delivery, and refuses one signed for another moment', async () => {
    const raw = 'whsec_c2VjcmV0LXRoaW5n';
    vi.stubEnv('RESEND_WEBHOOK_SECRET', raw);
    const body = JSON.stringify({ messageId: 'b', from: 'ada@glossup.com', subject: 'Hi', text: 'Hello' });
    const id = 'msg_1';
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(raw.replace(/^whsec_/, '')), (character) => character.charCodeAt(0)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sign = async (at: number) =>
      btoa(
        String.fromCharCode(
          ...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${at}.${body}`))),
        ),
      );

    const headers = (at: number, signature: string) => ({
      'svix-id': id,
      'svix-timestamp': String(at),
      'svix-signature': `v1,${signature}`,
      'content-type': 'application/json',
    });
    expect((await post(headers(timestamp, await sign(timestamp)), body)).status).toBe(200);

    // An hour old: signed properly once, but too late to be replayed now.
    const stale = timestamp - 3600;
    expect((await post(headers(stale, await sign(stale)), body)).status).toBe(401);
  });
});
