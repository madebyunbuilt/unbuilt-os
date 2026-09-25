import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Support in the client portal (12-client-portal.md, Support). Two things are being checked throughout: a client
// reaches only their own company's tickets, and nothing the studio wrote to itself ever appears.

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

const lagos = (iso: string) => Date.parse(`${iso}+01:00`);

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let ada: Awaited<ReturnType<typeof createClientUser>>;
let other: Awaited<ReturnType<typeof createClientUser>>;

async function travelTo(iso: string) {
  vi.setSystemTime(lagos(iso));
  const now = Date.now();
  await t.run(async (ctx) => {
    for (const { sessionId, authUserId } of [pm, ada, other]) {
      const row = await ctx.db
        .query('sessionActivity')
        .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
        .unique();
      if (row) await ctx.db.patch('sessionActivity', row._id, { lastActiveAt: now });
      else await ctx.db.insert('sessionActivity', { sessionId, authUserId, lastActiveAt: now });
    }
  });
}

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
  other = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
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

const raise = async (overrides: object = {}) =>
  await ada.as.mutation(api.portalTickets.create, {
    subject: 'Checkout is down',
    description: 'Nobody can pay.',
    priority: 'p2',
    ...overrides,
  });

describe('a client raising a ticket', () => {
  it('records who asked, and what was promised', async () => {
    const ticketId = await raise();
    const ticket = await ada.as.query(api.portalTickets.get, { ticketId });
    expect(ticket).toMatchObject({ subject: 'Checkout is down', status: 'with_unbuilt', priority: 'p2' });
    expect(ticket!.messages.map((m) => [m.fromUnbuilt, m.body])).toEqual([[false, 'Nobody can pay.']]);

    const stored = await t.run((ctx) => ctx.db.query('tickets').first());
    expect(stored).toMatchObject({ channel: 'portal', requesterContactId: ada.contactId });
    // A P2 raised at 10:00 on a Monday: four business hours to be answered.
    expect(stored!.firstResponseDueAt).toBe(lagos('2026-10-12T14:00:00'));
  });

  it('tells the studio there is something waiting', async () => {
    await raise();
    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notifications.filter((n) => n.event === 'ticket.created').map((n) => n.recipientId)).toContain(pm.memberId);
  });

  it('refuses a project belonging to somebody else', async () => {
    const projectId = await pm.as.mutation(api.projects.create, {
      clientId: other.clientId,
      name: 'Qravit site',
      type: 'web_platform',
      billingModel: 'fixed',
      currency: 'NGN',
      startDate: '2026-09-01',
    });
    await expectCode(raise({ projectId }), 'tickets.notFound');
  });
});

describe('what a client is shown', () => {
  it('never shows an internal note', async () => {
    const ticketId = await raise();
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Gateway is flaky.', visibility: 'internal' });
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'We are on it.', visibility: 'public' });
    const ticket = await ada.as.query(api.portalTickets.get, { ticketId });
    expect(ticket!.messages.map((m) => m.body)).toEqual(['Nobody can pay.', 'We are on it.']);
  });

  it('says where the ticket stands in their terms, not the studio’s', async () => {
    const ticketId = await raise();
    // `new` and `open` both mean Unbuilt has it, which is all the client needs.
    expect((await ada.as.query(api.portalTickets.get, { ticketId }))!.status).toBe('with_unbuilt');
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Which card?', visibility: 'public' });
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'pending_client' });
    expect((await ada.as.query(api.portalTickets.get, { ticketId }))!.status).toBe('with_you');
  });

  it('shows the whole company’s tickets, and nobody else’s', async () => {
    await raise();
    await other.as.mutation(api.portalTickets.create, {
      subject: 'Not yours',
      description: 'x',
      priority: 'p3',
    });
    const mine = await ada.as.query(api.portalTickets.list, {});
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe('Checkout is down');
  });

  it('is not there at all when it belongs to another client', async () => {
    const ticketId = await raise();
    expect(await other.as.query(api.portalTickets.get, { ticketId })).toBeNull();
    await expectCode(other.as.mutation(api.portalTickets.reply, { ticketId, body: 'Hello' }), 'tickets.notFound');
  });

  it('is closed to a client whose role cannot see tickets', async () => {
    const ticketId = await raise();
    await t.run(async (ctx) => {
      const role = await ctx.db.get('roles', roles.client_member);
      await ctx.db.patch('roles', role!._id, {
        permissions: role!.permissions.filter((key) => !key.startsWith('portal.tickets')),
      });
      await ctx.db.patch('contacts', ada.contactId, { portalRoleId: roles.client_member });
    });
    await expectCode(ada.as.query(api.portalTickets.list, {}), 'auth.forbidden');
    await expectCode(ada.as.query(api.portalTickets.get, { ticketId }), 'auth.forbidden');
    await expectCode(
      ada.as.mutation(api.portalTickets.create, { subject: 's', description: 'd', priority: 'p3' }),
      'auth.forbidden',
    );
  });
});

describe('a client replying', () => {
  it('starts the clock again when the studio was waiting on them', async () => {
    const ticketId = await raise();
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Which card?', visibility: 'public' });
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'pending_client' });
    const paused = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!.resolutionDueAt!;

    await travelTo('2026-10-13T10:00:00');
    await ada.as.mutation(api.portalTickets.reply, { ticketId, body: 'A Visa card.' });
    const ticket = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!;
    expect(ticket.status).toBe('open');
    expect(ticket.pausedAt).toBeUndefined();
    // The day they took is added back, so the studio is not charged for it.
    expect(ticket.resolutionDueAt).toBeGreaterThan(paused);
  });

  it('reopens a ticket resolved within the last week, and promises it afresh', async () => {
    const ticketId = await raise();
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Fixed.', visibility: 'public' });
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'resolved' });

    await travelTo('2026-10-15T10:00:00');
    expect((await ada.as.query(api.portalTickets.get, { ticketId }))!.canReopen).toBe(true);
    const result = await ada.as.mutation(api.portalTickets.reply, { ticketId, body: 'Still broken.' });
    expect(result).toMatchObject({ ticketId, reopened: true, isNew: false });

    const ticket = (await t.run((ctx) => ctx.db.get('tickets', ticketId)))!;
    expect(ticket.status).toBe('open');
    expect(ticket.resolvedAt).toBeUndefined();
    // Promised again from the moment they came back: a reply by 14:00 that day, not a target that went long ago.
    expect(ticket.firstRespondedAt).toBeUndefined();
    expect(ticket.firstResponseDueAt).toBe(lagos('2026-10-15T14:00:00'));
    expect(ticket.breachedResolutionAt).toBeUndefined();
    // The thread is kept, which is the point of reopening rather than starting again.
    expect((await ada.as.query(api.portalTickets.get, { ticketId }))!.messages).toHaveLength(3);
  });

  it('starts a new ticket when they come back after the week is up', async () => {
    const first = await raise();
    await pm.as.mutation(api.tickets.reply, { ticketId: first, body: 'Fixed.', visibility: 'public' });
    await pm.as.mutation(api.tickets.setStatus, { ticketId: first, status: 'resolved' });

    // Eight days on. The clock moves rather than the calendar: a portal session only lasts a week, so somebody coming
    // back this late has signed in again, and that is not what this test is about.
    await t.run((ctx) => ctx.db.patch('tickets', first, { resolvedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    expect((await ada.as.query(api.portalTickets.get, { ticketId: first }))!.canReopen).toBe(false);
    const result = await ada.as.mutation(api.portalTickets.reply, { ticketId: first, body: 'It is back.' });
    expect(result.isNew).toBe(true);
    expect(result.ticketId).not.toBe(first);

    const created = (await t.run((ctx) => ctx.db.get('tickets', result.ticketId)))!;
    expect(created.reopenedFromTicketId).toBe(first);
    expect(created.subject).toBe('Checkout is down');
    // The old one is left as it was resolved.
    expect((await t.run((ctx) => ctx.db.get('tickets', first)))!.status).toBe('resolved');
  });

  it('starts a new ticket when the old one was closed', async () => {
    const first = await raise();
    await pm.as.mutation(api.tickets.setStatus, { ticketId: first, status: 'closed' });
    const result = await ada.as.mutation(api.portalTickets.reply, { ticketId: first, body: 'One more thing.' });
    expect(result.isNew).toBe(true);
    expect((await t.run((ctx) => ctx.db.get('tickets', result.ticketId)))!.reopenedFromTicketId).toBe(first);
  });

  it('tells whoever is holding the ticket, and says when it is open again', async () => {
    const ticketId = await raise();
    await pm.as.mutation(api.tickets.assign, { ticketId, assigneeMemberId: pm.memberId });
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Fixed.', visibility: 'public' });
    await pm.as.mutation(api.tickets.setStatus, { ticketId, status: 'resolved' });
    await ada.as.mutation(api.portalTickets.reply, { ticketId, body: 'Still broken.' });
    const reopened = (await t.run((ctx) => ctx.db.query('notifications').collect())).filter(
      (n) => n.event === 'ticket.reopened',
    );
    expect(reopened.map((n) => n.recipientId)).toEqual([pm.memberId]);
    expect(reopened[0].link).toBe(`/support/tickets/${ticketId}`);
  });
});
