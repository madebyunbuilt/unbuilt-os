import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, type TestConvex } from './test.auth';

// Retainers (08-billing-and-finance.md, Retainers). What matters here: the fee is invoiced a period in advance, the
// overage for the period that just closed goes out with it, unused minutes carry one period only, and the hours-used
// alerts reach the manager and the client once each.

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
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let finance: Awaited<ReturnType<typeof createTeamMember>>;
let dayo: Awaited<ReturnType<typeof createTeamMember>>;
let clientId: Id<'clients'>;
let projectId: Id<'projects'>;

const FEE = 500_000_00; // ₦500,000 a month
const INCLUDED = 600; // 10 hours
const OVERAGE_PER_HOUR = 25_000_00; // ₦25,000

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-01T08:00:00Z'));
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  vi.stubEnv('FILE_URL_SECRET', 'test-file-url-secret-that-is-long-enough');
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  finance = await createTeamMember(t, roles.finance, { email: 'funmi@unbuilt.studio', name: 'Funmi Eze' });
  dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio', name: 'Dayo Ade' });
  clientId = await pm.as.mutation(api.clients.create, { displayName: 'Glossup', kind: 'company', tags: [] });
  projectId = await pm.as.mutation(api.projects.create, {
    clientId,
    name: 'Glossup support',
    type: 'retainer',
    billingModel: 'retainer',
    currency: 'NGN',
    startDate: '2026-10-01',
  });
  await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dayo.memberId });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const newRetainer = async (overrides: object = {}) =>
  await finance.as.mutation(api.retainers.create, {
    projectId,
    startDate: '2026-10-01',
    monthlyFeeMinor: FEE,
    includedMinutes: INCLUDED,
    overageRateMinor: OVERAGE_PER_HOUR,
    invoiceDayOfMonth: 1,
    ...overrides,
  });

const invoices = () => t.run((ctx) => ctx.db.query('invoices').collect());
const periods = (retainerId: Id<'retainers'>) =>
  t.run((ctx) =>
    ctx.db
      .query('retainerPeriods')
      .withIndex('by_retainer_start', (q) => q.eq('retainerId', retainerId))
      .collect(),
  );

/**
 * Approved time on the retainer's project, which is what counts against the included hours. Written straight in: the
 * clock here jumps whole months, which would put the entry in the future and expire the logger's session.
 */
async function logApproved(minutes: number, date: string) {
  return await t.run((ctx) =>
    ctx.db.insert('timeEntries', {
      memberId: dayo.memberId,
      projectId,
      date,
      weekStart: date,
      minutes,
      description: 'Support',
      billable: true,
      status: 'approved',
      approvedBy: pm.memberId,
      approvedAt: Date.now(),
    }),
  );
}

describe('retainers', () => {
  it('opens a first period and invoices nothing until the period ends', async () => {
    const retainerId = await newRetainer();
    const view = await pm.as.query(api.retainers.forProject, { projectId });
    expect(view).toMatchObject({ status: 'active', monthlyFeeMinor: FEE, includedMinutes: INCLUDED });
    expect(view?.current).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-10-31', usedMinutes: 0 });

    // Time logged and approved the ordinary way is what counts against the hours.
    const entryId = await dayo.as.mutation(api.time.log, {
      projectId,
      date: '2026-10-01',
      minutes: 120,
      description: 'Support',
      billable: true,
    });
    // Logged but not yet approved, so it does not count against the hours yet.
    expect((await pm.as.query(api.retainers.forProject, { projectId }))?.current?.usedMinutes).toBe(0);
    await dayo.as.mutation(api.time.submitWeek, { weekStart: '2026-10-01' });
    await pm.as.mutation(api.time.approve, { entryIds: [entryId] });
    expect((await pm.as.query(api.retainers.forProject, { projectId }))?.current).toMatchObject({
      usedMinutes: 120,
      remainingMinutes: 480,
    });

    // Mid-period: nothing is due yet.
    vi.setSystemTime(Date.parse('2026-10-20T08:00:00Z'));
    expect(await t.mutation(internal.retainers.runDue, {})).toEqual({ rolled: 0 });
    expect(await invoices()).toHaveLength(0);
    expect(await periods(retainerId)).toHaveLength(1);
  });

  it('invoices the coming period in advance and the closed period’s overage with it', async () => {
    const retainerId = await newRetainer();
    // 14 hours used against 10 included: 4 hours over.
    await logApproved(600, '2026-10-05');
    await logApproved(240, '2026-10-19');

    vi.setSystemTime(Date.parse('2026-11-01T08:00:00Z'));
    expect(await t.mutation(internal.retainers.runDue, {})).toEqual({ rolled: 1 });

    const raised = await invoices();
    expect(raised).toHaveLength(2);
    const fee = raised.find((invoice) => invoice.type === 'retainer');
    const overage = raised.find((invoice) => invoice.type === 'time_and_materials');
    // The fee is for the period that is starting, not the one that ended.
    expect(fee?.lineItems[0].description).toBe('Retainer, 2026-11-01 to 2026-11-30 (10 hours included)');
    expect(fee?.totals.subtotalMinor).toBe(FEE);
    // 4 hours beyond the included time, at ₦25,000 an hour.
    expect(overage?.lineItems[0].description).toContain('4 hours beyond the included time');
    expect(overage?.totals.subtotalMinor).toBe(100_000_00);

    const all = await periods(retainerId);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ periodEnd: '2026-10-31', usedMinutes: 840, overageInvoiceId: overage?._id });
    expect(all[1]).toMatchObject({ periodStart: '2026-11-01', invoiceId: fee?._id, rolloverMinutes: 0 });
  });

  it('carries unused minutes one period only, and spends them first', async () => {
    const retainerId = await newRetainer({ rolloverUnusedMinutes: true });
    // 4 hours of the 10 used, so 6 carry.
    await logApproved(240, '2026-10-05');
    vi.setSystemTime(Date.parse('2026-11-01T08:00:00Z'));
    await t.mutation(internal.retainers.runDue, {});
    expect((await periods(retainerId))[1]).toMatchObject({ rolloverMinutes: 360, includedMinutes: 600 });

    // November: 8 hours used. The carried 6 go first, then 2 of November's own, so 8 of its own carry — never the
    // carried ones, which expire here.
    await logApproved(480, '2026-11-10');
    vi.setSystemTime(Date.parse('2026-12-01T08:00:00Z'));
    await t.mutation(internal.retainers.runDue, {});
    const all = await periods(retainerId);
    expect(all[2]).toMatchObject({ rolloverMinutes: 480, includedMinutes: 600 });
    // Nothing went over, so only the two monthly fees were invoiced.
    expect((await invoices()).filter((invoice) => invoice.type === 'time_and_materials')).toHaveLength(0);
  });

  it('does not carry anything when rollover is off', async () => {
    const retainerId = await newRetainer({ rolloverUnusedMinutes: false });
    await logApproved(60, '2026-10-05');
    vi.setSystemTime(Date.parse('2026-11-01T08:00:00Z'));
    await t.mutation(internal.retainers.runDue, {});
    expect((await periods(retainerId))[1]).toMatchObject({ rolloverMinutes: 0 });
  });

  it('tells the manager and the client at 80% and again when the hours are gone, once each', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('contacts', {
        clientId,
        name: 'Ada Obi',
        email: 'ada@glossup.com',
        isPrimary: true,
        isBilling: true,
        portalAccess: true,
        status: 'active',
      });
    });
    await newRetainer();
    await logApproved(480, '2026-10-05'); // 8 of 10 hours
    await t.mutation(internal.retainers.runDue, {});
    let notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices.filter((notice) => notice.event === 'retainer_hours_80')).toHaveLength(2);
    expect(notices.map((notice) => notice.recipientKind).sort()).toEqual(['client', 'team']);

    // Running again the same day says nothing further.
    await t.mutation(internal.retainers.runDue, {});
    notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices).toHaveLength(2);

    // Past the included hours: one more round, to both.
    await logApproved(180, '2026-10-06');
    await t.mutation(internal.retainers.runDue, {});
    notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices.filter((notice) => notice.event === 'retainer_hours_used')).toHaveLength(2);
    await t.mutation(internal.retainers.runDue, {});
    expect(await t.run((ctx) => ctx.db.query('notifications').collect())).toHaveLength(4);
  });

  it('leaves a paused retainer alone', async () => {
    const retainerId = await newRetainer();
    await finance.as.mutation(api.retainers.setStatus, { retainerId, status: 'paused' });
    vi.setSystemTime(Date.parse('2026-11-01T08:00:00Z'));
    expect(await t.mutation(internal.retainers.runDue, {})).toEqual({ rolled: 0 });
    expect(await invoices()).toHaveLength(0);
  });

  it('refuses a second retainer on a project, and terms that make no sense', async () => {
    await newRetainer();
    await expectCode(newRetainer(), 'retainers.exists');
    const other = await pm.as.mutation(api.projects.create, {
      clientId,
      name: 'Another',
      type: 'retainer',
      billingModel: 'retainer',
      currency: 'NGN',
      startDate: '2026-10-01',
    });
    await expectCode(
      finance.as.mutation(api.retainers.create, {
        projectId: other,
        startDate: '2026-10-01',
        monthlyFeeMinor: 0,
        includedMinutes: INCLUDED,
        overageRateMinor: OVERAGE_PER_HOUR,
        invoiceDayOfMonth: 1,
      }),
      'retainers.invalid',
    );
    await expectCode(
      finance.as.mutation(api.retainers.create, {
        projectId: other,
        startDate: '2026-10-01',
        monthlyFeeMinor: FEE,
        includedMinutes: INCLUDED,
        overageRateMinor: OVERAGE_PER_HOUR,
        invoiceDayOfMonth: 45,
      }),
      'retainers.invalid',
    );
  });

  it('keeps retainers to the people who handle money', async () => {
    const retainerId = await newRetainer();
    await expectCode(
      pm.as.mutation(api.retainers.create, {
        projectId,
        startDate: '2026-10-01',
        monthlyFeeMinor: FEE,
        includedMinutes: INCLUDED,
        overageRateMinor: OVERAGE_PER_HOUR,
        invoiceDayOfMonth: 1,
      }),
      'auth.forbidden',
    );
    await expectCode(pm.as.mutation(api.retainers.setStatus, { retainerId, status: 'paused' }), 'auth.forbidden');
    // Anyone on the project can see where the hours stand.
    expect(await dayo.as.query(api.retainers.forProject, { projectId })).toMatchObject({ includedMinutes: INCLUDED });
  });
});
