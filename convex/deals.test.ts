import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import {
  asSession,
  createAuthSession,
  createClientUser,
  createTeamMember,
  newTest,
  type TestConvex,
} from './test.auth';

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

const DAY = 24 * 60 * 60 * 1000;

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let admin: Awaited<ReturnType<typeof createTeamMember>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let finance: Awaited<ReturnType<typeof createTeamMember>>;
let clientId: Id<'clients'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Monday 14 September 2026, 17:00 in Lagos.
  vi.setSystemTime(Date.parse('2026-09-14T16:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  admin = await createTeamMember(t, roles.admin, { email: 'kemi@unbuilt.studio', name: 'Kemi Bello' });
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio', name: 'Funmi' });
  clientId = await pm.as.mutation(api.clients.create, { displayName: 'Glossup', kind: 'company', tags: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

const stageNamed = async (name: string) =>
  (await pm.as.query(api.pipeline.stages, {})).find((stage) => stage.name === name)!;

const newDeal = (overrides: object = {}) =>
  pm.as.mutation(api.deals.create, {
    clientId,
    title: 'E-commerce rebuild',
    valueMinor: 1_000_000_00,
    currency: 'NGN' as const,
    services: ['web'],
    ...overrides,
  });

/** A fresh session for the project manager after the clock has moved on by days. */
async function pmSignsInAgain() {
  const session = await createAuthSession(t, { email: `tobi+${Date.now()}@unbuilt.studio` });
  await t.run((ctx) => ctx.db.patch('teamMembers', pm.memberId, { authUserId: session.authUserId }));
  return asSession(t, session);
}

const reminders = () =>
  t.run((ctx) =>
    ctx.db
      .query('notifications')
      .collect()
      .then((rows) => rows.filter((row) => row.event.startsWith('deal.'))),
  );

describe('pipeline', () => {
  it('seeds the default stages and lost reasons, readable with deals.view', async () => {
    expect((await finance.as.query(api.pipeline.stages, {})).map((s) => [s.name, s.probabilityBps, s.kind])).toEqual([
      ['New', 1000, 'open'],
      ['Discovery', 2500, 'open'],
      ['Proposal sent', 5000, 'open'],
      ['Negotiation', 7500, 'open'],
      ['Won', 10000, 'won'],
      ['Lost', 0, 'lost'],
    ]);
    expect((await finance.as.query(api.pipeline.lostReasons, {}))[0].label).toBe('Budget');
    const member = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    await expectCode(member.as.query(api.pipeline.stages, {}), 'auth.forbidden');
  });

  it('lets project managers add, reorder, rename and remove open stages, keeping Won and Lost last', async () => {
    const qualified = await pm.as.mutation(api.pipeline.createStage, { name: 'Qualified', probabilityBps: 1500 });
    const [newStage, discovery] = [await stageNamed('New'), await stageNamed('Discovery')];
    const proposal = await stageNamed('Proposal sent');
    const negotiation = await stageNamed('Negotiation');
    await pm.as.mutation(api.pipeline.reorderStages, {
      openStageIds: [newStage.id, qualified, discovery.id, proposal.id, negotiation.id],
    });
    expect((await pm.as.query(api.pipeline.stages, {})).map((s) => s.name)).toEqual([
      'New',
      'Qualified',
      'Discovery',
      'Proposal sent',
      'Negotiation',
      'Won',
      'Lost',
    ]);

    const won = await stageNamed('Won');
    await pm.as.mutation(api.pipeline.updateStage, { stageId: won.id, name: 'Signed', probabilityBps: 5 });
    expect(await stageNamed('Signed')).toMatchObject({ probabilityBps: 10000 });
    await expectCode(pm.as.mutation(api.pipeline.removeStage, { stageId: won.id }), 'crm.invalid');
    await expectCode(
      pm.as.mutation(api.pipeline.reorderStages, { openStageIds: [newStage.id, qualified] }),
      'crm.invalid',
    );

    const dealId = await newDeal({ stageId: qualified });
    await expectCode(pm.as.mutation(api.pipeline.removeStage, { stageId: qualified }), 'crm.stageHasDeals');
    await pm.as.mutation(api.pipeline.removeStage, { stageId: qualified, moveDealsTo: discovery.id });
    expect((await pm.as.query(api.deals.get, { dealId })).stage?.name).toBe('Discovery');

    await expectCode(
      finance.as.mutation(api.pipeline.createStage, { name: 'Nope', probabilityBps: 0 }),
      'auth.forbidden',
    );
    await expectCode(pm.as.mutation(api.pipeline.createStage, { name: 'new', probabilityBps: 0 }), 'crm.duplicate');
  });

  it('manages lost reasons; retired ones cannot be chosen', async () => {
    const reasonId = await pm.as.mutation(api.pipeline.createLostReason, { label: 'Chose a freelancer' });
    await pm.as.mutation(api.pipeline.setLostReasonActive, { reasonId, active: false });
    expect((await pm.as.query(api.pipeline.lostReasons, {})).map((r) => r.label)).not.toContain('Chose a freelancer');
    const dealId = await newDeal();
    await expectCode(
      pm.as.mutation(api.deals.moveToStage, { dealId, stageId: (await stageNamed('Lost')).id, lostReasonId: reasonId }),
      'crm.lostNeedsReason',
    );
    await expectCode(pm.as.mutation(api.pipeline.createLostReason, { label: 'budget' }), 'crm.duplicate');
  });
});

describe('deals', () => {
  it('creates a deal in the first open stage with its probability, owned by the creator', async () => {
    const dealId = await newDeal();
    expect(await finance.as.query(api.deals.get, { dealId })).toMatchObject({
      stage: { name: 'New', kind: 'open' },
      probabilityBps: 1000,
      ownerName: 'Tobi Ade',
      clientName: 'Glossup',
    });
    await expectCode(
      finance.as.mutation(api.deals.create, { clientId, title: 'X', valueMinor: 1, currency: 'NGN', services: [] }),
      'auth.forbidden',
    );
    await expectCode(newDeal({ stageId: (await stageNamed('Won')).id }), 'crm.invalid');
    await expectCode(newDeal({ valueMinor: -1 }), 'crm.invalid');

    const client = await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@portal.co' });
    await expectCode(client.as.query(api.deals.get, { dealId }), 'auth.forbidden');
    await expectCode(client.as.query(api.deals.board, {}), 'auth.forbidden');
  });

  it('records stage moves on the timeline, blocks Won without a project and Lost without a reason', async () => {
    const dealId = await newDeal();
    const proposal = await stageNamed('Proposal sent');
    await pm.as.mutation(api.deals.moveToStage, { dealId, stageId: proposal.id });
    expect(await pm.as.query(api.deals.get, { dealId })).toMatchObject({ probabilityBps: 5000 });

    await expectCode(
      pm.as.mutation(api.deals.moveToStage, { dealId, stageId: (await stageNamed('Won')).id }),
      'crm.wonNeedsProject',
    );
    const lost = await stageNamed('Lost');
    await expectCode(pm.as.mutation(api.deals.moveToStage, { dealId, stageId: lost.id }), 'crm.lostNeedsReason');
    const [budget] = await pm.as.query(api.pipeline.lostReasons, {});
    await pm.as.mutation(api.deals.moveToStage, {
      dealId,
      stageId: lost.id,
      lostReasonId: budget.id,
      lostNote: 'Could only spend half',
    });
    expect(await pm.as.query(api.deals.get, { dealId })).toMatchObject({
      stage: { kind: 'lost' },
      lostReason: 'Budget',
      lostNote: 'Could only spend half',
      lostAt: Date.now(),
      probabilityBps: 0,
    });

    const timeline = await pm.as.query(api.activities.list, {
      subject: { table: 'deals', id: dealId },
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(timeline.page.map((e) => [e.type, e.title, e.body])).toEqual([
      ['status_change', 'Moved from Proposal sent to Lost', 'Budget: Could only spend half'],
      ['status_change', 'Moved from New to Proposal sent', undefined],
      ['system', 'Deal created in New', undefined],
    ]);
    // Deal entries also appear on the client's timeline.
    const clientTimeline = await pm.as.query(api.activities.list, {
      subject: { table: 'clients', id: clientId },
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(clientTimeline.page[0].title).toBe('Moved from Proposal sent to Lost');

    // Reopening clears the loss.
    await pm.as.mutation(api.deals.moveToStage, { dealId, stageId: proposal.id });
    const reopened = await pm.as.query(api.deals.get, { dealId });
    expect(reopened.lostReason).toBeUndefined();
    expect(reopened.lostAt).toBeUndefined();
  });

  it('adds up pipeline value and weighted value per currency from open deals only', async () => {
    await newDeal({ valueMinor: 1_000_000_00, probabilityBps: 1000 });
    await newDeal({ valueMinor: 333_33, probabilityBps: 3333 });
    await newDeal({ valueMinor: 5_000_00, currency: 'USD', probabilityBps: 5000 });
    const lostDeal = await newDeal({ valueMinor: 9_999_999_00 });
    const [budget] = await pm.as.query(api.pipeline.lostReasons, {});
    await pm.as.mutation(api.deals.moveToStage, {
      dealId: lostDeal,
      stageId: (await stageNamed('Lost')).id,
      lostReasonId: budget.id,
    });

    expect(await finance.as.query(api.deals.pipelineSummary, {})).toEqual({
      // 100,000,000 × 10% + 33,333 × 33.33% (11,109.8889 → 11,110), rounded per deal.
      NGN: { count: 2, valueMinor: 100_033_333, weightedMinor: 10_000_000 + 11_110 },
      USD: { count: 1, valueMinor: 500_000, weightedMinor: 250_000 },
    });
    expect(await pm.as.query(api.deals.list, {})).toHaveLength(3);
    expect(await pm.as.query(api.deals.list, { status: 'lost' })).toHaveLength(1);
  });

  it('blocks deleting a client with deals; only Owner and Admins delete deals', async () => {
    const dealId = await newDeal();
    await expectCode(admin.as.mutation(api.clients.remove, { clientId }), 'crm.hasHistory');
    await expectCode(pm.as.mutation(api.deals.remove, { dealId }), 'auth.forbidden');
    await admin.as.mutation(api.deals.remove, { dealId });
    await admin.as.mutation(api.clients.remove, { clientId });
  });
});

describe('follow-up reminders', () => {
  it('reminds the owner once when a deal goes 7 days without activity or a future follow-up', async () => {
    const dealId = await newDeal();
    vi.setSystemTime(Date.now() + 6 * DAY);
    await t.mutation(internal.deals.sendFollowUpReminders, {});
    expect(await reminders()).toEqual([]);

    vi.setSystemTime(Date.now() + DAY);
    expect(await t.mutation(internal.deals.sendFollowUpReminders, {})).toEqual({ followUps: 0, idle: 1 });
    const [reminder] = await reminders();
    expect(reminder).toMatchObject({
      recipientId: pm.memberId,
      event: 'deal.idle',
      title: 'E-commerce rebuild has gone quiet',
      link: `/crm/deals/${dealId}`,
    });

    // Exactly once per idle period.
    vi.setSystemTime(Date.now() + DAY);
    await t.mutation(internal.deals.sendFollowUpReminders, {});
    expect(await reminders()).toHaveLength(1);

    // A note starts a new period, which reminds again after another 7 quiet days.
    await (
      await pmSignsInAgain()
    ).mutation(api.activities.add, {
      subject: { table: 'deals', id: dealId },
      type: 'call',
      body: 'Chased them',
    });
    vi.setSystemTime(Date.now() + 7 * DAY);
    await t.mutation(internal.deals.sendFollowUpReminders, {});
    expect(await reminders()).toHaveLength(2);
  });

  it('does not call a deal idle while a follow-up is planned, and reminds on a missed follow-up date', async () => {
    const dealId = await newDeal({ nextFollowUpDate: '2026-09-25' });
    vi.setSystemTime(Date.parse('2026-09-24T16:00:00Z'));
    await t.mutation(internal.deals.sendFollowUpReminders, {});
    expect(await reminders()).toEqual([]);

    // The follow-up date arrives with nothing logged: remind that day, once.
    vi.setSystemTime(Date.parse('2026-09-25T16:00:00Z'));
    expect(await t.mutation(internal.deals.sendFollowUpReminders, {})).toEqual({ followUps: 1, idle: 0 });
    expect((await reminders())[0]).toMatchObject({
      event: 'deal.followUpDue',
      title: 'Follow up on E-commerce rebuild',
    });
    await t.mutation(internal.deals.sendFollowUpReminders, {});
    expect(await reminders()).toHaveLength(1);

    // Logging activity on the follow-up date means no reminder for the next one either.
    await (await pmSignsInAgain()).mutation(api.deals.setFollowUp, { dealId, date: '2026-09-28' });
    vi.setSystemTime(Date.parse('2026-09-28T09:00:00Z'));
    await (
      await pmSignsInAgain()
    ).mutation(api.activities.add, {
      subject: { table: 'deals', id: dealId },
      type: 'note',
      body: 'Sent the deck',
    });
    vi.setSystemTime(Date.parse('2026-09-28T16:00:00Z'));
    await t.mutation(internal.deals.sendFollowUpReminders, {});
    expect(await reminders()).toHaveLength(1);
  });

  it('never reminds about closed deals', async () => {
    const dealId = await newDeal();
    const [budget] = await pm.as.query(api.pipeline.lostReasons, {});
    await pm.as.mutation(api.deals.moveToStage, {
      dealId,
      stageId: (await stageNamed('Lost')).id,
      lostReasonId: budget.id,
    });
    vi.setSystemTime(Date.now() + 30 * DAY);
    await t.mutation(internal.deals.sendFollowUpReminders, {});
    expect(await reminders()).toEqual([]);
  });
});
