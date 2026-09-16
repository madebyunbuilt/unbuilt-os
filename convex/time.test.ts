import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, type TestConvex } from './test.auth';

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let owner: Awaited<ReturnType<typeof createTeamMember>>;
let admin: Awaited<ReturnType<typeof createTeamMember>>;
let tobi: Awaited<ReturnType<typeof createTeamMember>>;
let kemi: Awaited<ReturnType<typeof createTeamMember>>;
let finance: Awaited<ReturnType<typeof createTeamMember>>;
let dayo: Awaited<ReturnType<typeof createTeamMember>>;
let clientId: Id<'clients'>;
let tobisProject: Id<'projects'>;
let kemisProject: Id<'projects'>;

const MONDAY = '2026-09-14';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Wednesday 16 September 2026, in the week starting Monday the 14th.
  vi.setSystemTime(Date.parse('2026-09-16T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  owner = await createTeamMember(t, roles.owner, { email: 'hello@unbuilt.studio', name: 'Unbuilt Studio' });
  admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio', name: 'Admin Ada' });
  tobi = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  kemi = await createTeamMember(t, roles.project_manager, { email: 'kemi@unbuilt.studio', name: 'Kemi Bello' });
  finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio', name: 'Funmi' });
  dayo = await createTeamMember(t, roles.member, {
    email: 'dayo@unbuilt.studio',
    name: 'Dayo Ade',
    costRateMinor: 500_000,
    billRateMinor: 1_500_000,
    rateCurrency: 'NGN',
  });
  clientId = await tobi.as.mutation(api.clients.create, { displayName: 'Glossup', kind: 'company', tags: [] });
  const project = {
    clientId,
    type: 'web_platform' as const,
    billingModel: 'time_and_materials' as const,
    currency: 'NGN' as const,
    startDate: '2026-09-01',
  };
  tobisProject = await tobi.as.mutation(api.projects.create, { ...project, name: 'Glossup web' });
  kemisProject = await kemi.as.mutation(api.projects.create, { ...project, name: 'Glossup app' });
  await tobi.as.mutation(api.projects.addProjectMember, { projectId: tobisProject, memberId: dayo.memberId });
  await kemi.as.mutation(api.projects.addProjectMember, { projectId: kemisProject, memberId: dayo.memberId });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const logTime = (
  who: Awaited<ReturnType<typeof createTeamMember>>,
  overrides: {
    projectId?: Id<'projects'>;
    date?: string;
    minutes?: number;
    billable?: boolean;
    description?: string;
  } = {},
) =>
  who.as.mutation(api.time.log, {
    projectId: overrides.projectId ?? tobisProject,
    date: overrides.date ?? '2026-09-15',
    minutes: overrides.minutes ?? 180,
    description: overrides.description ?? 'Built the dashboard',
    billable: overrides.billable ?? true,
  });

describe('logging time', () => {
  it('keeps the rates that applied when the entry was logged, even after they change', async () => {
    const entryId = await logTime(dayo);
    const entry = await t.run((ctx) => ctx.db.get('timeEntries', entryId));
    expect(entry).toMatchObject({
      status: 'draft',
      weekStart: MONDAY,
      costRateMinor: 500_000,
      billRateMinor: 1_500_000,
      rateCurrency: 'NGN',
    });

    await finance.as.mutation(api.team.setRates, {
      memberId: dayo.memberId,
      costRateMinor: 900_000,
      billRateMinor: 2_500_000,
      currency: 'NGN',
    });
    const second = await logTime(dayo, { date: '2026-09-16' });
    expect((await t.run((ctx) => ctx.db.get('timeEntries', entryId)))?.billRateMinor).toBe(1_500_000);
    expect((await t.run((ctx) => ctx.db.get('timeEntries', second)))?.billRateMinor).toBe(2_500_000);
  });

  it('records time from someone without rates and flags it for Finance to fix', async () => {
    const bisi = await createTeamMember(t, roles.member, { email: 'bisi@unbuilt.studio', name: 'Bisi Obi' });
    await tobi.as.mutation(api.projects.addProjectMember, { projectId: tobisProject, memberId: bisi.memberId });
    const entryId = await logTime(bisi, { minutes: 60 });

    const [forBisi] = (await bisi.as.query(api.time.myWeek, {})).entries;
    expect(forBisi.missingRates).toBe(true);
    expect(forBisi).not.toHaveProperty('billRateMinor');

    const [forFinance] = (await finance.as.query(api.time.listForProject, { projectId: tobisProject })).entries;
    expect(forFinance.missingRates).toBe(true);
    expect(forFinance.billRateMinor).toBeUndefined();
    await finance.as.mutation(api.time.setEntryRates, {
      entryId,
      costRateMinor: 300_000,
      billRateMinor: 800_000,
      currency: 'NGN',
    });
    expect((await finance.as.query(api.time.listForProject, { projectId: tobisProject })).entries[0]).toMatchObject({
      missingRates: false,
      billRateMinor: 800_000,
    });
    await expectCode(
      tobi.as.mutation(api.time.setEntryRates, { entryId, billRateMinor: 1, currency: 'NGN' }),
      'auth.forbidden',
    );

    const audited = await t.run((ctx) => ctx.db.query('auditLog').collect());
    const rateChange = audited.find((row) => row.table === 'timeEntries' && row.actorId === finance.memberId);
    // The change is recorded; the amounts are not.
    expect(rateChange?.diff).toMatchObject({ after: { billRateMinor: '[redacted]', costRateMinor: '[redacted]' } });
  });

  it('refuses time on projects you are not on, future dates and impossible lengths', async () => {
    const other = await createTeamMember(t, roles.member, { email: 'other@unbuilt.studio' });
    await expectCode(logTime(other), 'projects.notFound');
    await expectCode(logTime(dayo, { date: '2026-09-17' }), 'time.future');
    await expectCode(logTime(dayo, { minutes: 0 }), 'time.invalid');
    await expectCode(logTime(dayo, { minutes: 25 * 60 }), 'time.invalid');
    // Finance can see every project but cannot log time at all.
    await expectCode(logTime(finance), 'auth.forbidden');
  });

  it('edits and deletes your own entries, and an edited submitted entry goes back to draft', async () => {
    const entryId = await logTime(dayo);
    await dayo.as.mutation(api.time.update, {
      entryId,
      projectId: tobisProject,
      date: '2026-09-15',
      minutes: 240,
      description: 'Built the dashboard and fixed the header',
      billable: false,
    });
    await dayo.as.mutation(api.time.submitWeek, { weekStart: MONDAY });
    await dayo.as.mutation(api.time.update, {
      entryId,
      projectId: tobisProject,
      date: '2026-09-15',
      minutes: 300,
      description: 'Rounded up',
      billable: false,
    });
    expect((await dayo.as.query(api.time.myWeek, {})).entries[0]).toMatchObject({ status: 'draft', minutes: 300 });

    const mine = await logTime(tobi, { minutes: 60 });
    await expectCode(dayo.as.mutation(api.time.remove, { entryId: mine }), 'time.locked');
    await dayo.as.mutation(api.time.remove, { entryId });
    expect((await dayo.as.query(api.time.myWeek, {})).entries).toEqual([]);
  });
});

describe('weekly submission and approval', () => {
  it('submits a week and lets the project manager approve it, but never their own time', async () => {
    await logTime(dayo, { minutes: 180 });
    await logTime(dayo, { date: '2026-09-16', minutes: 120 });
    const tobisOwn = await logTime(tobi, { minutes: 60 });

    expect(await dayo.as.mutation(api.time.submitWeek, { weekStart: MONDAY })).toEqual({ submitted: 2 });
    await expectCode(dayo.as.mutation(api.time.submitWeek, { weekStart: MONDAY }), 'time.nothingToSubmit');
    await tobi.as.mutation(api.time.submitWeek, { weekStart: MONDAY });

    const waiting = await tobi.as.query(api.time.pendingApprovals, {});
    expect(waiting).toEqual([
      { memberId: dayo.memberId, memberName: 'Dayo Ade', weekStart: MONDAY, minutes: 300, entries: 2 },
    ]);
    await expectCode(tobi.as.mutation(api.time.approve, { entryIds: [tobisOwn] }), 'time.ownTime');

    const week = await tobi.as.query(api.time.weekForReview, { memberId: dayo.memberId, weekStart: MONDAY });
    expect(week.map((entry) => entry.canDecide)).toEqual([true, true]);
    expect(await tobi.as.mutation(api.time.approve, { entryIds: week.map((entry) => entry.id) })).toEqual({
      changed: 2,
    });
    expect((await dayo.as.query(api.time.myWeek, {})).entries.map((e) => [e.status, e.approvedByName])).toEqual([
      ['approved', 'Tobi Ade'],
      ['approved', 'Tobi Ade'],
    ]);
    // An approved entry is out of the member's hands.
    await expectCode(
      dayo.as.mutation(api.time.update, {
        entryId: week[0].id,
        projectId: tobisProject,
        date: '2026-09-15',
        minutes: 60,
        description: 'x',
        billable: true,
      }),
      'time.locked',
    );
    expect(await tobi.as.query(api.time.pendingApprovals, {})).toEqual([]);
  });

  it('lets the Owner approve their own week; Admins approve anyone', async () => {
    await tobi.as.mutation(api.projects.addProjectMember, { projectId: tobisProject, memberId: owner.memberId });
    const ownersEntry = await logTime(owner, { minutes: 90 });
    await owner.as.mutation(api.time.submitWeek, { weekStart: MONDAY });
    expect(await owner.as.mutation(api.time.approve, { entryIds: [ownersEntry] })).toEqual({ changed: 1 });

    await tobi.as.mutation(api.projects.addProjectMember, { projectId: tobisProject, memberId: admin.memberId });
    const adminsEntry = await logTime(admin, { minutes: 30 });
    await admin.as.mutation(api.time.submitWeek, { weekStart: MONDAY });
    await expectCode(admin.as.mutation(api.time.approve, { entryIds: [adminsEntry] }), 'time.ownTime');
    expect(await owner.as.mutation(api.time.approve, { entryIds: [adminsEntry] })).toEqual({ changed: 1 });
  });

  it('keeps project managers to the projects they manage', async () => {
    const onKemis = await logTime(dayo, { projectId: kemisProject, minutes: 120 });
    const onTobis = await logTime(dayo, { projectId: tobisProject, minutes: 60 });
    await dayo.as.mutation(api.time.submitWeek, { weekStart: MONDAY });

    expect((await tobi.as.query(api.time.pendingApprovals, {}))[0].minutes).toBe(60);
    expect((await kemi.as.query(api.time.pendingApprovals, {}))[0].minutes).toBe(120);
    await expectCode(tobi.as.mutation(api.time.approve, { entryIds: [onKemis] }), 'time.notYours');
    await kemi.as.mutation(api.time.approve, { entryIds: [onKemis] });
    // The Owner and Admins reach every project.
    await admin.as.mutation(api.time.approve, { entryIds: [onTobis] });
    await expectCode(finance.as.query(api.time.pendingApprovals, {}), 'auth.forbidden');
  });

  it('returns entries with a note, which puts them back in the member’s hands', async () => {
    const entryId = await logTime(dayo, { minutes: 480, description: 'Whole day' });
    await dayo.as.mutation(api.time.submitWeek, { weekStart: MONDAY });
    await expectCode(tobi.as.mutation(api.time.returnEntries, { entryIds: [entryId], note: '  ' }), 'time.needsNote');
    await tobi.as.mutation(api.time.returnEntries, { entryIds: [entryId], note: 'Split this across the two tasks' });

    const [entry] = (await dayo.as.query(api.time.myWeek, {})).entries;
    expect(entry).toMatchObject({ status: 'draft', returnedNote: 'Split this across the two tasks', canEdit: true });
    await dayo.as.mutation(api.time.update, {
      entryId,
      projectId: tobisProject,
      date: '2026-09-15',
      minutes: 240,
      description: 'Dashboard',
      billable: true,
    });
    expect((await dayo.as.query(api.time.myWeek, {})).entries[0].returnedNote).toBeUndefined();
  });
});

describe('the timer', () => {
  it('starts, stops into a draft entry, and refuses a second timer', async () => {
    await dayo.as.mutation(api.time.startTimer, { projectId: tobisProject, description: 'Pairing' });
    expect(await dayo.as.query(api.time.runningTimer, {})).toMatchObject({
      description: 'Pairing',
      startedAt: Date.now(),
    });
    await expectCode(dayo.as.mutation(api.time.startTimer, { projectId: tobisProject }), 'time.timerRunning');

    vi.setSystemTime(Date.now() + 95 * 60_000 + 30_000);
    const entryId = await dayo.as.mutation(api.time.stopTimer, {});
    expect(await t.run((ctx) => ctx.db.get('timeEntries', entryId))).toMatchObject({
      // 95 and a half minutes, rounded up.
      minutes: 96,
      description: 'Pairing',
      status: 'draft',
      billable: true,
      date: '2026-09-16',
    });
    expect(await dayo.as.query(api.time.runningTimer, {})).toBeNull();
    await expectCode(dayo.as.mutation(api.time.stopTimer, {}), 'time.noTimer');

    await dayo.as.mutation(api.time.startTimer, { projectId: tobisProject });
    await dayo.as.mutation(api.time.cancelTimer, {});
    expect(await dayo.as.query(api.time.runningTimer, {})).toBeNull();
  });

  it('caps a timer left running overnight at 12 hours', async () => {
    await dayo.as.mutation(api.time.startTimer, { projectId: tobisProject, description: 'Forgot to stop' });
    // The timer ran overnight while the app stayed open.
    await t.run(async (ctx) => {
      const timer = (await ctx.db.query('timers').collect())[0];
      await ctx.db.patch('timers', timer._id, { startedAt: Date.now() - 20 * 60 * 60_000 });
    });
    const entryId = await dayo.as.mutation(api.time.stopTimer, { billable: false });
    expect((await t.run((ctx) => ctx.db.get('timeEntries', entryId)))?.minutes).toBe(12 * 60);
  });
});

describe('project and studio views', () => {
  it('shows everyone’s time to time.view.all and only your own to a member', async () => {
    await logTime(dayo, { minutes: 180 });
    await tobi.as.mutation(api.projects.addProjectMember, { projectId: tobisProject, memberId: admin.memberId });
    await logTime(admin, { minutes: 60, billable: false });

    const forFinance = await finance.as.query(api.time.listForProject, { projectId: tobisProject });
    expect(forFinance.scope).toBe('all');
    expect(forFinance.totals).toEqual({ minutes: 240, billableMinutes: 180 });
    const forDayo = await dayo.as.query(api.time.listForProject, { projectId: tobisProject });
    expect(forDayo.scope).toBe('own');
    expect(forDayo.totals).toEqual({ minutes: 180, billableMinutes: 180 });

    const summary = await tobi.as.query(api.time.projectSummary, { projectId: tobisProject });
    expect(summary).toMatchObject({ scope: 'all', loggedMinutes: 240, billableMinutes: 180, approvedMinutes: 0 });
    expect((await dayo.as.query(api.time.projectSummary, { projectId: tobisProject })).loggedMinutes).toBe(180);
  });

  it('lists last week’s unsubmitted time for time.view.all', async () => {
    await logTime(dayo, { date: '2026-09-07', minutes: 300 });
    await logTime(dayo, { minutes: 120 });
    const outstanding = await admin.as.query(api.time.outstandingWeeks, {});
    expect(outstanding).toEqual([
      { memberId: dayo.memberId, memberName: 'Dayo Ade', weekStart: '2026-09-07', minutes: 300 },
    ]);
    await expectCode(dayo.as.query(api.time.outstandingWeeks, {}), 'auth.forbidden');
    expect((await dayo.as.query(api.time.myRecentProjects, {})).map((p) => p.name)).toEqual([
      'Glossup app',
      'Glossup web',
    ]);
  });
});
