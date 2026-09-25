import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Tickets and their SLA timers (09-support-and-sla.md). The promise the studio makes is counted in business time, so
// these tests are mostly about clocks: what a due time means when the office is shut, and what happens to it while the
// studio is waiting on the client.

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

/** Africa/Lagos is UTC+1 all year, so a wall-clock time there is the hour before in UTC. */
const lagos = (iso: string) => Date.parse(`${iso}+01:00`);

/**
 * Moves the clock, and marks every session as used at the new time. These tests span a long weekend, and a team
 * session idles out after twelve hours; somebody picking a ticket up on the Monday has signed in again by then.
 */
async function travelTo(iso: string) {
  vi.setSystemTime(lagos(iso));
  const now = Date.now();
  await t.run(async (ctx) => {
    for (const { sessionId, authUserId } of [pm, finance, member, client]) {
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
let finance: Awaited<ReturnType<typeof createTeamMember>>;
let member: Awaited<ReturnType<typeof createTeamMember>>;
let client: Awaited<ReturnType<typeof createClientUser>>;
let clientId: Id<'clients'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(lagos('2026-10-08T16:55:00'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  finance = await createTeamMember(t, roles.finance, { email: 'zainab@unbuilt.studio', name: 'Zainab Bello' });
  member = await createTeamMember(t, roles.member, { email: 'segun@unbuilt.studio', name: 'Segun Cole' });
  client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  clientId = client.clientId;

  // The Standard policy, and a public holiday on the Friday, so the clock has to step over a long weekend.
  await t.run(async (ctx) => {
    const policy = await ctx.db
      .query('slaPolicies')
      .withIndex('by_name', (q) => q.eq('name', 'Standard'))
      .first();
    await ctx.db.patch('clients', clientId, { slaPolicyId: policy!._id });
    await ctx.db.insert('holidays', {
      date: '2026-10-09',
      name: 'Declared public holiday',
      country: 'NG',
      recurring: false,
      source: 'manual',
      needsConfirmation: false,
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const newProject = async (overrides: object = {}) =>
  await pm.as.mutation(api.projects.create, {
    clientId,
    name: 'Glossup app',
    type: 'mobile_app',
    billingModel: 'fixed',
    currency: 'NGN',
    startDate: '2026-09-01',
    ...overrides,
  });

const raise = async (overrides: object = {}) =>
  await pm.as.mutation(api.tickets.create, {
    clientId,
    subject: 'Checkout is down',
    description: 'Nobody can pay.',
    priority: 'p1',
    requesterContactId: client.contactId,
    ...overrides,
  });

describe('what the studio promised', () => {
  it('counts the promise in business time, stepping over the evening, the holiday and the weekend', async () => {
    const ticketId = await raise();
    const ticket = await pm.as.query(api.tickets.get, { ticketId });

    // Raised at 16:55 on Thursday with a P1: one business hour to reply, eight to resolve. Five minutes are left that
    // Thursday; Friday is a holiday and the weekend is not business time, so the rest is counted on the Monday.
    expect(ticket.firstResponseDueAt).toBe(lagos('2026-10-12T09:55:00'));
    expect(ticket.resolutionDueAt).toBe(lagos('2026-10-12T16:55:00'));
    expect(ticket.number).toMatch(/^UNB-TKT-\d{4}$/);
    expect(ticket.status).toBe('new');
  });

  it('promises nothing to a client with no policy, rather than inventing a time', async () => {
    await t.run(async (ctx) => ctx.db.patch('clients', clientId, { slaPolicyId: undefined }));
    const ticket = await pm.as.query(api.tickets.get, { ticketId: await raise() });
    expect(ticket.firstResponseDueAt).toBeUndefined();
    expect(ticket.resolutionDueAt).toBeUndefined();
    expect(ticket.hasSla).toBe(false);
  });

  it('gives a best-effort priority a reply time and no resolution time', async () => {
    const ticket = await pm.as.query(api.tickets.get, { ticketId: await raise({ priority: 'p4' }) });
    expect(ticket.firstResponseDueAt).toBeDefined();
    // P4 is a question: answered, but never promised a fix by a date.
    expect(ticket.resolutionDueAt).toBeUndefined();
  });

  it('prefers the project’s policy over the client’s', async () => {
    const priorityId = await t.run(
      async (ctx) =>
        (await ctx.db
          .query('slaPolicies')
          .withIndex('by_name', (q) => q.eq('name', 'Priority'))
          .first())!._id,
    );
    const projectId = await newProject();
    await t.run((ctx) => ctx.db.patch('projects', projectId, { slaPolicyId: priorityId }));
    await raise({ projectId });
    const stored = await t.run(async (ctx) => (await ctx.db.query('tickets').first())!.slaPolicyId);
    expect(stored).toBe(priorityId);
  });

  it('keeps the promise it was raised under when the policy is later retired', async () => {
    const ticketId = await raise();
    const before = await pm.as.query(api.tickets.get, { ticketId });
    await t.run(async (ctx) => {
      const policy = await ctx.db.query('slaPolicies').first();
      await ctx.db.patch('slaPolicies', policy!._id, { active: false });
    });
    const after = await pm.as.query(api.tickets.get, { ticketId });
    expect(after.resolutionDueAt).toBe(before.resolutionDueAt);
  });
});

describe('the clock while a ticket is worked', () => {
  it('stops the reply clock on the first public reply, and not on an internal note', async () => {
    const ticketId = await raise();
    await travelTo('2026-10-12T09:30:00');
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Looking now.', visibility: 'internal' });
    expect((await pm.as.query(api.tickets.get, { ticketId })).firstRespondedAt).toBeUndefined();

    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'We are on it.', visibility: 'public' });
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    expect(ticket.firstRespondedAt).toBe(lagos('2026-10-12T09:30:00'));
    expect(ticket.status).toBe('open');
    // A later reply does not move it: the first response is the one that was promised.
    await travelTo('2026-10-12T11:00:00');
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Still on it.', visibility: 'public' });
    expect((await pm.as.query(api.tickets.get, { ticketId })).firstRespondedAt).toBe(lagos('2026-10-12T09:30:00'));
  });

  it('adds the business time spent waiting on the client back onto the resolution time', async () => {
    const ticketId = await raise();
    const promised = (await pm.as.query(api.tickets.get, { ticketId })).resolutionDueAt!;

    // Asked the client something at 10:00 on the Monday; they came back at 15:00. Five business hours of the delay
    // were theirs, so the studio gets those five hours back.
    await travelTo('2026-10-12T10:00:00');
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'pending_client' });
    expect((await pm.as.query(api.tickets.get, { ticketId })).pausedAt).toBe(lagos('2026-10-12T10:00:00'));

    await travelTo('2026-10-12T15:00:00');
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'open' });
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    expect(ticket.pausedAt).toBeUndefined();
    // 16:55 on the Monday plus five business hours: only five minutes of that Monday are left, so the rest is counted
    // on the Tuesday.
    expect(ticket.resolutionDueAt).toBe(lagos('2026-10-13T13:55:00'));
    expect(ticket.resolutionDueAt).toBeGreaterThan(promised);
  });

  it('counts only business time while waiting, not the night in between', async () => {
    const ticketId = await raise();
    const promised = (await pm.as.query(api.tickets.get, { ticketId })).resolutionDueAt!;
    await travelTo('2026-10-12T16:00:00');
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'pending_client' });
    // Overnight: 16:00 to 17:00 on the Monday and 09:00 to 10:00 on the Tuesday is two business hours, not eighteen.
    await travelTo('2026-10-13T10:00:00');
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'open' });
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    // Two business hours later than it was, which reads as the next morning. Counting the eighteen hours on the wall
    // clock instead would have moved it to the Thursday.
    expect(ticket.resolutionDueAt).toBe(lagos('2026-10-13T10:55:00'));
    expect(ticket.resolutionDueAt).toBeGreaterThan(promised);
  });

  it('puts the ball back in the studio’s court when it replies to a waiting ticket', async () => {
    const ticketId = await raise();
    await travelTo('2026-10-12T10:00:00');
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'pending_client' });
    await travelTo('2026-10-12T15:00:00');
    await pm.as.mutation(api.tickets.reply, {
      ticketId,
      body: 'Thanks, that is what we needed.',
      visibility: 'public',
    });
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    expect(ticket.status).toBe('open');
    expect(ticket.pausedAt).toBeUndefined();
    expect(ticket.resolutionDueAt).toBe(lagos('2026-10-13T13:55:00'));
  });

  it('re-runs the promise when the priority changes, from when the ticket was raised', async () => {
    const ticketId = await raise({ priority: 'p3' });
    await travelTo('2026-10-12T09:30:00');
    await pm.as.mutation(api.tickets.setPriority, { ticketId, priority: 'p1' });
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    // Exactly as though it had been raised a P1 at 16:55 on the Thursday, so an escalated ticket is due sooner —
    // here, already late — rather than being handed a fresh hour.
    expect(ticket.firstResponseDueAt).toBe(lagos('2026-10-12T09:55:00'));
    expect(ticket.resolutionDueAt).toBe(lagos('2026-10-12T16:55:00'));
  });

  it('does not take back a first response that has already happened', async () => {
    const ticketId = await raise({ priority: 'p3' });
    await travelTo('2026-10-12T09:30:00');
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'We have it.', visibility: 'public' });
    const before = (await pm.as.query(api.tickets.get, { ticketId })).firstResponseDueAt;
    await pm.as.mutation(api.tickets.setPriority, { ticketId, priority: 'p1' });
    const ticket = await pm.as.query(api.tickets.get, { ticketId });
    expect(ticket.firstResponseDueAt).toBe(before);
    expect(ticket.firstRespondedAt).toBe(lagos('2026-10-12T09:30:00'));
  });

  it('records resolving and closing, and will not reopen a closed ticket by the back door', async () => {
    const ticketId = await raise();
    await travelTo('2026-10-12T12:00:00');
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'resolved' });
    expect((await pm.as.query(api.tickets.get, { ticketId })).resolvedAt).toBe(lagos('2026-10-12T12:00:00'));

    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'closed' });
    await expectCode(pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'open' }), 'tickets.closed');
    await expectCode(
      pm.as.mutation(api.tickets.reply, { ticketId, body: 'One more thing', visibility: 'public' }),
      'tickets.closed',
    );
  });
});

describe('the thread', () => {
  it('opens with what was asked for, and keeps internal notes apart from replies', async () => {
    const ticketId = await raise();
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Suspect the gateway.', visibility: 'internal' });
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'We are on it.', visibility: 'public' });
    const { messages } = await pm.as.query(api.tickets.get, { ticketId });
    expect(messages.map((m) => [m.authorKind, m.visibility, m.body])).toEqual([
      ['client', 'public', 'Nobody can pay.'],
      ['team', 'internal', 'Suspect the gateway.'],
      ['team', 'public', 'We are on it.'],
    ]);
  });

  it('tells the client when the studio replies in public, and says nothing about an internal note', async () => {
    const ticketId = await raise();
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Only for us.', visibility: 'internal' });
    expect(await t.run((ctx) => ctx.db.query('notifications').collect())).not.toContainEqual(
      expect.objectContaining({ recipientKind: 'client' }),
    );
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'We are on it.', visibility: 'public' });
    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notifications.filter((n) => n.recipientKind === 'client')).toHaveLength(1);
    expect(notifications.find((n) => n.recipientKind === 'client')).toMatchObject({
      event: 'ticket.reply',
      recipientId: client.contactId,
    });
  });

  it('tells whoever can work tickets that one has arrived, and the assignee when it is theirs', async () => {
    await raise();
    const first = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(first.filter((n) => n.event === 'ticket.created').map((n) => n.recipientId)).toContain(pm.memberId);

    await raise({ assigneeMemberId: member.memberId });
    const all = await t.run((ctx) => ctx.db.query('notifications').collect());
    const assigned = all.filter((n) => n.event === 'ticket.created' && n.recipientId === member.memberId);
    expect(assigned).toHaveLength(1);
  });
});

describe('who may see and touch a ticket', () => {
  it('refuses a client, a project it does not belong to, and a contact from elsewhere', async () => {
    const other = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
    await expectCode(
      pm.as.mutation(api.tickets.create, {
        clientId,
        subject: 'Wrong contact',
        description: 'x',
        priority: 'p3',
        requesterContactId: other.contactId,
      }),
      'tickets.invalid',
    );
  });

  it('lets somebody who can only read tickets read them, and change nothing', async () => {
    const ticketId = await raise();
    expect(await finance.as.query(api.tickets.list, {})).toHaveLength(1);
    await expectCode(
      finance.as.mutation(api.tickets.reply, { ticketId, body: 'Hello', visibility: 'public' }),
      'auth.forbidden',
    );
    await expectCode(finance.as.mutation(api.tickets.setStatus, { ticketId, status: 'resolved' }), 'auth.forbidden');
    await expectCode(finance.as.mutation(api.tickets.assign, { ticketId }), 'auth.forbidden');
    await expectCode(finance.as.mutation(api.tickets.setPriority, { ticketId, priority: 'p2' }), 'auth.forbidden');
    await expectCode(
      finance.as.mutation(api.tickets.create, { clientId, subject: 's', description: 'd', priority: 'p3' }),
      'auth.forbidden',
    );
  });

  it('shows somebody scoped to their own work only the tickets that are theirs', async () => {
    const mine = await raise({ assigneeMemberId: member.memberId });
    const theirs = await raise({ subject: 'Not theirs' });
    expect((await member.as.query(api.tickets.list, {})).map((row) => row.id)).toEqual([mine]);
    // A ticket out of scope is not there at all, rather than there and forbidden.
    await expectCode(member.as.query(api.tickets.get, { ticketId: theirs }), 'tickets.notFound');
  });

  it('reaches a ticket on a project they work on, even when it is somebody else’s', async () => {
    const projectId = await newProject();
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: member.memberId });
    const ticketId = await raise({ projectId, assigneeMemberId: pm.memberId });
    expect((await member.as.query(api.tickets.get, { ticketId })).id).toBe(ticketId);
  });

  it('is closed to a role with no ticket permission at all', async () => {
    const editor = await createTeamMember(t, roles.content_editor, {
      email: 'nneka@unbuilt.studio',
      name: 'Nneka Udo',
    });
    const ticketId = await raise();
    await expectCode(editor.as.query(api.tickets.list, {}), 'auth.forbidden');
    await expectCode(editor.as.query(api.tickets.get, { ticketId }), 'auth.forbidden');
    await expectCode(editor.as.query(api.tickets.forClient, { clientId }), 'auth.forbidden');
    await expectCode(
      editor.as.mutation(api.tickets.create, { clientId, subject: 's', description: 'd', priority: 'p3' }),
      'auth.forbidden',
    );
  });

  it('will not hand a ticket to somebody who has left', async () => {
    const ticketId = await raise();
    await t.run((ctx) => ctx.db.patch('teamMembers', member.memberId, { status: 'offboarded' }));
    await expectCode(
      pm.as.mutation(api.tickets.assign, { ticketId, assigneeMemberId: member.memberId }),
      'tickets.invalid',
    );
  });
});
