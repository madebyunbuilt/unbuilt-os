import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { previousMonth } from './lib/slaReports';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// The monthly SLA report (09-support-and-sla.md). It tells a client how the studio did against what it promised, so
// the figures have to be true about a month that has closed, and have to stay true afterwards.

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
let clientId: Id<'clients'>;

/**
 * Moves the clock, keeping everybody signed in. These tests cross a month boundary, which is longer than both a
 * session's own life and the twelve hours of idleness that ends one, and neither is what they are about.
 */
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
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: 'session',
          where: [{ field: '_id', value: sessionId }],
          update: { expiresAt: now + 7 * 24 * 60 * 60 * 1000, updatedAt: now },
        },
      });
    }
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // A Thursday in the middle of the month, so tickets raised here land in October.
  vi.setSystemTime(lagos('2026-10-08T10:00:00'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  clientId = ada.clientId;
  await t.run(async (ctx) => {
    const policy = await ctx.db
      .query('slaPolicies')
      .withIndex('by_name', (q) => q.eq('name', 'Standard'))
      .first();
    await ctx.db.patch('clients', clientId, { slaPolicyId: policy!._id });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const raise = async (overrides: object = {}) =>
  await pm.as.mutation(api.tickets.create, {
    clientId,
    subject: 'Checkout is down',
    description: 'Nobody can pay.',
    priority: 'p2',
    requesterContactId: ada.contactId,
    ...overrides,
  });

/** Generates October's report from November, the way the cron does. */
async function octoberReport() {
  await travelTo('2026-11-02T07:30:00');
  await t.mutation(internal.slaReports.generateMonthly, {});
  const report = await t.run((ctx) => ctx.db.query('slaReports').first());
  return await pm.as.query(api.slaReports.get, { reportId: report!._id });
}

describe('which month a report covers', () => {
  it('is the one that has just closed', () => {
    expect(previousMonth('2026-11-02')).toEqual({ periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    // Across a year boundary, and across a February.
    expect(previousMonth('2027-01-04')).toEqual({ periodStart: '2026-12-01', periodEnd: '2026-12-31' });
    expect(previousMonth('2028-03-01')).toEqual({ periodStart: '2028-02-01', periodEnd: '2028-02-29' });
  });
});

describe('what a month looked like', () => {
  it('counts what was opened and resolved, by priority', async () => {
    const answered = await raise();
    await pm.as.mutation(api.tickets.reply, { ticketId: answered, body: 'On it.', visibility: 'public' });
    await pm.as.mutation(api.tickets.setStatus, { ticketId: answered, status: 'resolved' });
    await raise({ priority: 'p3', subject: 'A smaller thing' });

    const report = await octoberReport();
    const p2 = report!.byPriority.find((row) => row.priority === 'p2')!;
    const p3 = report!.byPriority.find((row) => row.priority === 'p3')!;
    expect(p2).toMatchObject({ opened: 1, resolved: 1, firstResponseComplianceBps: 10_000 });
    expect(p3).toMatchObject({ opened: 1, resolved: 0 });
  });

  it('says nothing about a priority that never came up, rather than claiming a perfect score', async () => {
    await raise();
    const report = await octoberReport();
    const p1 = report!.byPriority.find((row) => row.priority === 'p1')!;
    // No P1 tickets is not the same as meeting every P1 target.
    expect(p1.opened).toBe(0);
    expect(p1.firstResponseComplianceBps).toBeUndefined();
  });

  it('counts a missed target as missed, and says how late it was', async () => {
    const ticketId = await raise();
    // A P2 raised at 10:00 on the Thursday is promised a reply by 14:00. Answered the next morning instead.
    await travelTo('2026-10-09T11:00:00');
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Sorry for the delay.', visibility: 'public' });

    const report = await octoberReport();
    expect(report!.byPriority.find((row) => row.priority === 'p2')!.firstResponseComplianceBps).toBe(0);
    // Two: the reply came late, and the ticket was never resolved at all, so its fix time went by as well.
    expect(report!.breaches.map((breach) => breach.target).sort()).toEqual(['firstResponse', 'resolution']);
    const reply = report!.breaches.find((breach) => breach.target === 'firstResponse')!;
    expect(reply).toMatchObject({ number: 'UNB-TKT-0001' });
    // 14:00 Thursday to 11:00 Friday is five business hours, not twenty-one.
    expect(reply.lateMinutes).toBe(300);
  });

  it('carries the reason the studio gave for missing it', async () => {
    const ticketId = await raise();
    await travelTo('2026-10-09T11:00:00');
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Sorry.', visibility: 'public' });
    await pm.as.mutation(api.slaReports.setBreachReason, {
      ticketId,
      reason: 'Raised at the end of the day during the release freeze.',
    });
    const report = await octoberReport();
    expect(report!.breaches[0].reason).toBe('Raised at the end of the day during the release freeze.');
  });

  it('leaves out a ticket raised in another month', async () => {
    await raise();
    await travelTo('2026-11-02T09:00:00');
    await raise({ subject: 'November problem' });
    const report = await octoberReport();
    expect(report!.byPriority.reduce((total, row) => total + row.opened, 0)).toBe(1);
  });

  it('says outright that nothing was being monitored, rather than showing an empty section', async () => {
    await raise();
    const report = await octoberReport();
    expect(report!.monitoring).toBe('not_monitored');
  });
});

describe('writing and sending it', () => {
  it('is written once, however often the month is run', async () => {
    await raise();
    await travelTo('2026-11-02T07:30:00');
    const first = await t.mutation(internal.slaReports.generateMonthly, {});
    const second = await t.mutation(internal.slaReports.generateMonthly, {});
    expect(first.generated).toBe(1);
    // A client is never handed a second version of the same month.
    expect(second.generated).toBe(0);
    expect(await t.run((ctx) => ctx.db.query('slaReports').collect())).toHaveLength(1);
  });

  it('waits for a person before the client sees it', async () => {
    await raise();
    const report = await octoberReport();
    expect(report!.status).toBe('draft');

    await pm.as.mutation(api.slaReports.send, { reportId: report!.id });
    const sent = await pm.as.query(api.slaReports.get, { reportId: report!.id });
    expect(sent!.status).toBe('sent');
    expect(sent!.sentAt).toBeDefined();
    // And the client is told it is there.
    const told = (await t.run((ctx) => ctx.db.query('notifications').collect())).filter(
      (n) => n.event === 'sla.report.sent',
    );
    expect(told.map((n) => n.recipientId)).toContain(ada.contactId);
  });

  it('will not send the same report twice', async () => {
    await raise();
    const report = await octoberReport();
    await pm.as.mutation(api.slaReports.send, { reportId: report!.id });
    await expectCode(pm.as.mutation(api.slaReports.send, { reportId: report!.id }), 'sla.alreadySent');
  });

  it('tells the studio when a client is still waiting after three days', async () => {
    await raise();
    await octoberReport();
    await travelTo('2026-11-03T09:00:00');
    expect(await t.mutation(internal.slaReports.remindUnsent, {})).toEqual({ reminded: 0 });

    await travelTo('2026-11-06T09:00:00');
    expect(await t.mutation(internal.slaReports.remindUnsent, {})).toEqual({ reminded: 1 });
    // Once only: a nag every morning is a nag nobody reads.
    expect(await t.mutation(internal.slaReports.remindUnsent, {})).toEqual({ reminded: 0 });
  });

  it('leaves alone a client with no SLA policy', async () => {
    await t.run((ctx) => ctx.db.patch('clients', clientId, { slaPolicyId: undefined }));
    await raise();
    await travelTo('2026-11-02T07:30:00');
    expect(await t.mutation(internal.slaReports.generateMonthly, {})).toEqual({ generated: 0 });
  });

  it('refuses to write a report for a month that is still running', async () => {
    await expectCode(pm.as.mutation(api.slaReports.generate, { clientId, periodStart: '2026-10-01' }), 'sla.invalid');
  });

  it('is closed to a role that does not hold SLA', async () => {
    await raise();
    const report = await octoberReport();
    const finance = await createTeamMember(t, roles.finance, { email: 'zainab@unbuilt.studio', name: 'Zainab B' });
    await expectCode(finance.as.query(api.slaReports.list, {}), 'auth.forbidden');
    await expectCode(finance.as.query(api.slaReports.get, { reportId: report!.id }), 'auth.forbidden');
    await expectCode(finance.as.mutation(api.slaReports.send, { reportId: report!.id }), 'auth.forbidden');
  });
});

describe('what a client can read', () => {
  it('sees nothing until the studio has sent it', async () => {
    await raise();
    const report = await octoberReport();
    // A draft is the studio's own working paper.
    expect(await ada.as.query(api.portalReports.list, {})).toEqual([]);
    expect(await ada.as.query(api.portalReports.get, { reportId: report!.id })).toBeNull();

    await pm.as.mutation(api.slaReports.send, { reportId: report!.id });
    const listed = await ada.as.query(api.portalReports.list, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ periodStart: '2026-10-01' });
    expect(await ada.as.query(api.portalReports.get, { reportId: report!.id })).not.toBeNull();
  });

  it('reads the same figures the studio read before sending them', async () => {
    const ticketId = await raise();
    await travelTo('2026-10-09T11:00:00');
    await pm.as.mutation(api.tickets.reply, { ticketId, body: 'Sorry.', visibility: 'public' });
    const report = await octoberReport();
    await pm.as.mutation(api.slaReports.send, { reportId: report!.id });

    const theirs = await ada.as.query(api.portalReports.get, { reportId: report!.id });
    expect(theirs!.byPriority).toEqual(report!.byPriority);
    expect(theirs!.breaches.map((b) => b.number)).toEqual(report!.breaches.map((b) => b.number));
  });

  it('never reaches another client’s month', async () => {
    await raise();
    const report = await octoberReport();
    await pm.as.mutation(api.slaReports.send, { reportId: report!.id });
    // Signed in after the month turned, so their session belongs to now rather than to October.
    const other = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
    expect(await other.as.query(api.portalReports.get, { reportId: report!.id })).toBeNull();
    expect(await other.as.query(api.portalReports.list, {})).toEqual([]);
  });
});
