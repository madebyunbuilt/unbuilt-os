import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;
let owner: Awaited<ReturnType<typeof createTeamMember>>;
let admin: Awaited<ReturnType<typeof createTeamMember>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let member: Awaited<ReturnType<typeof createTeamMember>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Monday 14 September 2026, 10:00 in Lagos.
  vi.setSystemTime(Date.parse('2026-09-14T09:00:00Z'));
  t = newTest();
  roles = await seedRoles(t);
  owner = await createTeamMember(t, roles.owner, { email: 'hello@unbuilt.studio', name: 'Unbuilt Studio' });
  admin = await createTeamMember(t, roles.admin, { email: 'kemi@unbuilt.studio', name: 'Kemi Bello' });
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  member = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio', name: 'Dayo Ade' });
  await t.run((ctx) =>
    ctx.db.insert('holidays', {
      date: '2026-10-01',
      name: 'Independence Day',
      country: 'NG',
      recurring: false,
      source: 'seed',
      needsConfirmation: false,
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const annual = (overrides: object = {}) => ({
  type: 'annual' as const,
  startDate: '2026-09-30',
  endDate: '2026-10-02',
  halfDay: false,
  note: 'Family wedding',
  ...overrides,
});

const notificationsFor = (memberId: Id<'teamMembers'>) =>
  t.run((ctx) =>
    ctx.db
      .query('notifications')
      .withIndex('by_recipient_created', (q) => q.eq('recipientKind', 'team').eq('recipientId', memberId))
      .collect(),
  );

const getRecord = (id: Id<'timeOff'>) => t.run((ctx) => ctx.db.get('timeOff', id));

describe('timeOff.request', () => {
  it('records the request and notifies every approver but the requester', async () => {
    const id = await member.as.mutation(api.timeOff.request, annual());
    expect(await getRecord(id)).toMatchObject({
      memberId: member.memberId,
      requestedBy: member.memberId,
      status: 'requested',
      note: 'Family wedding',
    });

    const [ownerNote] = await notificationsFor(owner.memberId);
    expect(ownerNote).toMatchObject({
      event: 'timeoff.requested',
      title: 'Dayo Ade requested time off',
      // Wed 30 Sep, Thu 1 Oct (Independence Day) and Fri 2 Oct.
      body: 'Annual leave, 30 Sep – 2 Oct 2026 (2 working days)',
      link: '/team/time-off',
    });
    expect(await notificationsFor(admin.memberId)).toHaveLength(1);
    expect(await notificationsFor(pm.memberId)).toHaveLength(0);
    expect(await notificationsFor(member.memberId)).toHaveLength(0);
  });

  it('refuses days with no work, overlaps, bad half days and callers outside the team', async () => {
    await expectCode(
      member.as.mutation(api.timeOff.request, annual({ startDate: '2026-10-03', endDate: '2026-10-04' })),
      'timeOff.noWorkingDays',
    );
    await expectCode(
      member.as.mutation(api.timeOff.request, annual({ startDate: '2026-10-01', endDate: '2026-10-01' })),
      'timeOff.noWorkingDays',
    );
    await expectCode(member.as.mutation(api.timeOff.request, annual({ halfDay: true })), 'timeOff.invalid');

    await member.as.mutation(api.timeOff.request, annual());
    await expectCode(
      member.as.mutation(api.timeOff.request, annual({ startDate: '2026-10-02', endDate: '2026-10-05' })),
      'timeOff.overlap',
    );
    // Another member's time off never clashes with yours.
    await pm.as.mutation(api.timeOff.request, annual());

    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(client.as.mutation(api.timeOff.request, annual()), 'auth.forbidden');
    await expectCode(t.mutation(api.timeOff.request, annual()), 'auth.unauthenticated');
  });
});

describe('deciding time off', () => {
  it('lets an approver approve or decline, and tells the member', async () => {
    const first = await member.as.mutation(api.timeOff.request, annual());
    const second = await member.as.mutation(
      api.timeOff.request,
      annual({ startDate: '2026-11-02', endDate: '2026-11-02' }),
    );

    await admin.as.mutation(api.timeOff.approve, { timeOffId: first });
    expect(await getRecord(first)).toMatchObject({ status: 'approved', decidedBy: admin.memberId });
    await admin.as.mutation(api.timeOff.decline, { timeOffId: second, note: 'Launch week' });
    expect(await getRecord(second)).toMatchObject({ status: 'declined', decisionNote: 'Launch week' });

    const bodies = (await notificationsFor(member.memberId)).map((n) => `${n.title}: ${n.body}`);
    expect(bodies).toEqual([
      'Your time off was approved: 30 Sep – 2 Oct 2026, by Kemi Bello.',
      'Your time off was declined: 2 Nov 2026, by Kemi Bello. Launch week',
    ]);
    await expectCode(admin.as.mutation(api.timeOff.approve, { timeOffId: second }), 'timeOff.alreadyDecided');
  });

  it('never lets anyone but the Owner decide their own time off', async () => {
    const adminOwn = await admin.as.mutation(api.timeOff.request, annual());
    await expectCode(admin.as.mutation(api.timeOff.approve, { timeOffId: adminOwn }), 'timeOff.ownRequest');
    await owner.as.mutation(api.timeOff.approve, { timeOffId: adminOwn });

    const ownerOwn = await owner.as.mutation(api.timeOff.request, annual());
    expect((await notificationsFor(admin.memberId)).at(-1)?.title).toBe('Unbuilt Studio requested time off');
    await owner.as.mutation(api.timeOff.approve, { timeOffId: ownerOwn });
    expect(await getRecord(ownerOwn)).toMatchObject({ status: 'approved', decidedBy: owner.memberId });
  });

  it('lists pending requests for approvers only, and refuses decisions without timeoff.approve', async () => {
    const id = await member.as.mutation(api.timeOff.request, annual());
    await expectCode(pm.as.mutation(api.timeOff.approve, { timeOffId: id }), 'auth.forbidden');
    await expectCode(member.as.mutation(api.timeOff.decline, { timeOffId: id }), 'auth.forbidden');
    await expectCode(pm.as.query(api.timeOff.pending, {}), 'auth.forbidden');

    const pending = await admin.as.query(api.timeOff.pending, {});
    expect(pending).toMatchObject([{ id, memberName: 'Dayo Ade', type: 'annual', days: 2, canDecide: true }]);
  });
});

describe('timeOff.record', () => {
  it('lets an approver record sick leave for someone, approved at once', async () => {
    const id = await admin.as.mutation(api.timeOff.record, {
      memberId: member.memberId,
      type: 'sick',
      startDate: '2026-09-14',
      endDate: '2026-09-14',
      halfDay: false,
    });
    expect(await getRecord(id)).toMatchObject({
      status: 'approved',
      requestedBy: admin.memberId,
      decidedBy: admin.memberId,
    });
    const [note] = await notificationsFor(member.memberId);
    expect(note).toMatchObject({
      title: 'Kemi Bello recorded time off for you',
      body: 'Sick leave, 14 Sep 2026 (1 working day)',
    });

    const [mine] = (await member.as.query(api.timeOff.mine, {})).requests;
    expect(mine).toMatchObject({ type: 'sick', enteredByName: 'Kemi Bello', decidedByName: 'Kemi Bello' });
  });

  it('records for others only, except the Owner, and only for active members', async () => {
    const sickDay = { type: 'sick' as const, startDate: '2026-09-15', endDate: '2026-09-15', halfDay: false };
    await expectCode(
      admin.as.mutation(api.timeOff.record, { memberId: admin.memberId, ...sickDay }),
      'timeOff.ownRequest',
    );
    await owner.as.mutation(api.timeOff.record, { memberId: owner.memberId, ...sickDay });
    await expectCode(pm.as.mutation(api.timeOff.record, { memberId: member.memberId, ...sickDay }), 'auth.forbidden');

    const invited = await t.run((ctx) =>
      ctx.db.insert('teamMembers', {
        name: 'New',
        email: 'new@unbuilt.studio',
        employmentType: 'contractor',
        roleId: roles.member,
        status: 'invited',
        timezone: 'Africa/Lagos',
        skills: [],
      }),
    );
    await expectCode(
      admin.as.mutation(api.timeOff.record, { memberId: invited, ...sickDay }),
      'timeOff.memberNotActive',
    );
  });
});

describe('timeOff.cancel', () => {
  it('lets members cancel approved time off until it starts, then only approvers can', async () => {
    // Starts today, so it has already started.
    const id = await member.as.mutation(
      api.timeOff.request,
      annual({ startDate: '2026-09-14', endDate: '2026-09-15' }),
    );
    await admin.as.mutation(api.timeOff.approve, { timeOffId: id });
    const later = await member.as.mutation(
      api.timeOff.request,
      annual({ startDate: '2026-11-02', endDate: '2026-11-03' }),
    );
    await admin.as.mutation(api.timeOff.approve, { timeOffId: later });

    await member.as.mutation(api.timeOff.cancel, { timeOffId: later });
    expect(await getRecord(later)).toMatchObject({ status: 'cancelled', cancelledBy: member.memberId });
    expect((await notificationsFor(admin.memberId)).at(-1)).toMatchObject({
      title: 'Dayo Ade cancelled their time off',
    });

    await expectCode(member.as.mutation(api.timeOff.cancel, { timeOffId: id }), 'timeOff.started');
    await expectCode(pm.as.mutation(api.timeOff.cancel, { timeOffId: id }), 'timeOff.notFound');
    await admin.as.mutation(api.timeOff.cancel, { timeOffId: id });
    expect((await notificationsFor(member.memberId)).at(-1)).toMatchObject({
      title: 'Your time off was cancelled',
      body: '14–15 Sep 2026, by Kemi Bello',
    });
    await expectCode(admin.as.mutation(api.timeOff.cancel, { timeOffId: id }), 'timeOff.notOpen');
  });

  it('lets members withdraw a pending request at any time', async () => {
    const id = await member.as.mutation(
      api.timeOff.request,
      annual({ startDate: '2026-09-01', endDate: '2026-09-02' }),
    );
    await member.as.mutation(api.timeOff.cancel, { timeOffId: id });
    expect((await getRecord(id))?.status).toBe('cancelled');
  });
});

describe('timeOff.calendar', () => {
  it('shows who is off to team.view, with the reason only for the member and approvers', async () => {
    const approved = await member.as.mutation(
      api.timeOff.request,
      annual({ type: 'sick', note: 'Hospital appointment' }),
    );
    await admin.as.mutation(api.timeOff.approve, { timeOffId: approved });
    const pendingId = await admin.as.mutation(
      api.timeOff.request,
      annual({ startDate: '2026-10-05', endDate: '2026-10-05' }),
    );
    const range = { from: '2026-09-28', to: '2026-10-11' };

    const forPm = await pm.as.query(api.timeOff.calendar, range);
    expect(forPm.entries).toHaveLength(1);
    expect(forPm.entries[0]).toMatchObject({ memberName: 'Dayo Ade', status: 'approved', days: 2, canCancel: false });
    expect(forPm.entries[0]).not.toHaveProperty('type');
    expect(forPm.entries[0]).not.toHaveProperty('note');
    expect(forPm.holidays).toEqual([{ date: '2026-10-01', name: 'Independence Day', needsConfirmation: false }]);
    expect(forPm.workingWeekdays).toEqual([1, 2, 3, 4, 5]);

    const forOwner = await owner.as.query(api.timeOff.calendar, range);
    expect(forOwner.entries.map((e) => [e.id, e.status, e.type])).toEqual([
      [approved, 'approved', 'sick'],
      [pendingId, 'requested', 'annual'],
    ]);
    expect(forOwner.entries[0].note).toBe('Hospital appointment');

    await expectCode(member.as.query(api.timeOff.calendar, range), 'auth.forbidden');
    await expectCode(pm.as.query(api.timeOff.calendar, { from: '2026-01-01', to: '2026-12-31' }), 'timeOff.invalid');
  });
});

describe('offboarding', () => {
  it('cancels pending requests and approved time off after the last day, keeping the past', async () => {
    const past = await admin.as.mutation(api.timeOff.record, {
      memberId: member.memberId,
      type: 'sick',
      startDate: '2026-09-10',
      endDate: '2026-09-10',
      halfDay: false,
    });
    const future = await member.as.mutation(api.timeOff.request, annual());
    await admin.as.mutation(api.timeOff.approve, { timeOffId: future });
    const pendingId = await member.as.mutation(
      api.timeOff.request,
      annual({ startDate: '2026-09-16', endDate: '2026-09-16' }),
    );

    await admin.as.mutation(api.team.offboard, { memberId: member.memberId, endDate: '2026-09-18' });
    expect((await getRecord(past))?.status).toBe('approved');
    expect((await getRecord(future))?.status).toBe('cancelled');
    expect((await getRecord(pendingId))?.status).toBe('cancelled');
  });
});
