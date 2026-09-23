import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, type TestConvex } from './test.auth';

// Billing schedules (08-billing-and-finance.md, Billing schedules). What matters here: a schedule only turns on once
// its items add up to the project; each trigger raises one draft invoice for its item and no more; the invoice carries
// the item's amount; and only finance can write a schedule.

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
let contactId: Id<'contacts'>;
let projectId: Id<'projects'>;

const BUDGET = 1_000_000_00; // ₦1,000,000

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-15T09:00:00Z'));
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
  contactId = await pm.as.mutation(api.contacts.create, {
    clientId,
    name: 'Ada Obi',
    email: 'ada@glossup.com',
    isBilling: true,
  });
  projectId = await pm.as.mutation(api.projects.create, {
    clientId,
    name: 'Glossup app',
    type: 'mobile_app',
    billingModel: 'fixed',
    currency: 'NGN',
    startDate: '2026-10-01',
    budgetMinor: BUDGET,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const halves = [
  { label: 'On signature', kind: 'percent' as const, bps: 5_000, trigger: 'on_signature' as const },
  { label: 'On final approval', kind: 'percent' as const, bps: 5_000, trigger: 'on_milestone_approved' as const },
];

const schedule = () => finance.as.query(api.billingSchedules.forProject, { projectId });
const invoices = () => t.run((ctx) => ctx.db.query('invoices').collect());

/** A signed contract document on this project, as the signing flow leaves one. */
const signedContract = async () =>
  await t.run((ctx) =>
    ctx.db.insert('documents', {
      type: 'contract',
      clientId,
      projectId,
      title: 'Build agreement',
      status: 'signed',
      blocks: [],
      currentVersion: 1,
      viewCount: 0,
      createdByMemberId: pm.memberId,
    }),
  );

describe('billing schedules', () => {
  it('splits a project into items and only activates once they add up', async () => {
    const scheduleId = await finance.as.mutation(api.billingSchedules.create, {
      projectId,
      items: [{ label: 'Deposit', kind: 'fixed', amountMinor: 400_000_00, trigger: 'on_signature' }],
    });
    expect(await schedule()).toMatchObject({
      status: 'draft',
      amountMinor: BUDGET,
      scheduledMinor: 400_000_00,
      autoSend: false,
    });
    await expectCode(finance.as.mutation(api.billingSchedules.activate, { scheduleId }), 'schedules.mismatch');

    await finance.as.mutation(api.billingSchedules.update, { scheduleId, items: halves });
    await finance.as.mutation(api.billingSchedules.activate, { scheduleId });
    const active = await schedule();
    expect(active).toMatchObject({ status: 'active', scheduledMinor: BUDGET });
    expect(active?.items.map((item) => item.amountMinor)).toEqual([500_000_00, 500_000_00]);
  });

  it('refuses a second schedule on the same project, and a project with nothing to split', async () => {
    await finance.as.mutation(api.billingSchedules.create, { projectId, items: halves });
    await expectCode(
      finance.as.mutation(api.billingSchedules.create, { projectId, items: halves }),
      'schedules.exists',
    );
    const other = await pm.as.mutation(api.projects.create, {
      clientId,
      name: 'Glossup site',
      type: 'web_platform',
      billingModel: 'fixed',
      currency: 'NGN',
      startDate: '2026-10-01',
    });
    await expectCode(
      finance.as.mutation(api.billingSchedules.create, { projectId: other, items: halves }),
      'schedules.noAmount',
    );
  });

  it('raises the deposit invoice when the contract is signed, once', async () => {
    const scheduleId = await finance.as.mutation(api.billingSchedules.create, { projectId, items: halves });
    await finance.as.mutation(api.billingSchedules.activate, { scheduleId });
    const documentId = await signedContract();

    await t.mutation(internal.billingSchedules.onDocumentSigned, { documentId });
    const raised = await invoices();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      status: 'draft',
      type: 'deposit',
      projectId,
      clientId,
      // Taxes and terms come from the client, as on any other draft.
      totals: expect.objectContaining({ subtotalMinor: 500_000_00, totalMinor: 500_000_00 }),
      paymentTermsDays: 14,
    });
    expect(raised[0].lineItems[0].description).toBe('Glossup app: On signature');
    expect((await schedule())?.items[0]).toMatchObject({ status: 'invoiced', invoiceId: raised[0]._id });

    // The same document signed again (a re-send, a replay) raises nothing further.
    await t.mutation(internal.billingSchedules.onDocumentSigned, { documentId });
    expect(await invoices()).toHaveLength(1);
  });

  it('raises the closing invoice when the last milestone is approved', async () => {
    const scheduleId = await finance.as.mutation(api.billingSchedules.create, { projectId, items: halves });
    await finance.as.mutation(api.billingSchedules.activate, { scheduleId });
    const milestoneId = await pm.as.mutation(api.milestones.create, { projectId, name: 'Launch' });
    const deliverableId = await pm.as.mutation(api.deliverables.create, { projectId, title: 'Build', milestoneId });
    await pm.as.mutation(api.deliverables.submitVersion, {
      deliverableId,
      uploads: [],
      links: [{ url: 'figma.com/build' }],
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(internal.deliverables.recordClientDecision, {
      deliverableId,
      contactId,
      version: 1,
      decision: 'approved',
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const raised = await invoices();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      type: 'milestone',
      totals: expect.objectContaining({ subtotalMinor: 500_000_00 }),
    });
    expect((await schedule())?.items[1]).toMatchObject({ status: 'invoiced' });
    expect(await t.run((ctx) => ctx.db.get('milestones', milestoneId))).toMatchObject({ status: 'invoiced' });
  });

  it('raises dated items on the day they fall due, and not before', async () => {
    const scheduleId = await finance.as.mutation(api.billingSchedules.create, {
      projectId,
      items: [
        { label: 'October', kind: 'fixed', amountMinor: 500_000_00, trigger: 'on_date', date: '2026-10-01' },
        { label: 'November', kind: 'fixed', amountMinor: 500_000_00, trigger: 'on_date', date: '2026-11-01' },
      ],
    });
    await finance.as.mutation(api.billingSchedules.activate, { scheduleId });

    expect(await t.mutation(internal.billingSchedules.invoiceDueItems, {})).toEqual({ invoiced: 0 });
    vi.setSystemTime(Date.parse('2026-10-01T08:00:00Z'));
    // The clock has moved past the session that created the schedule; the cron runs without one.
    expect(await t.mutation(internal.billingSchedules.invoiceDueItems, {})).toEqual({ invoiced: 1 });
    expect(await t.mutation(internal.billingSchedules.invoiceDueItems, {})).toEqual({ invoiced: 0 });
    expect(await invoices()).toHaveLength(1);
    // Read straight from the table: the clock has moved past the session that made the schedule.
    const after = await t.run((ctx) => ctx.db.get('billingSchedules', scheduleId));
    expect(after?.items.map((item) => item.status)).toEqual(['invoiced', 'pending']);
  });

  it('skips an item, and refuses to change items once part of the schedule is invoiced', async () => {
    const scheduleId = await finance.as.mutation(api.billingSchedules.create, { projectId, items: halves });
    await finance.as.mutation(api.billingSchedules.activate, { scheduleId });
    const items = (await schedule())!.items;

    await finance.as.mutation(api.billingSchedules.skipItem, {
      scheduleId,
      itemId: items[1].id,
      reason: 'The client paid the balance on another project',
    });
    expect((await schedule())?.items[1].status).toBe('skipped');

    await t.mutation(internal.billingSchedules.onDocumentSigned, { documentId: await signedContract() });
    await expectCode(
      finance.as.mutation(api.billingSchedules.update, { scheduleId, items: halves }),
      'schedules.invoiced',
    );
    await expectCode(
      finance.as.mutation(api.billingSchedules.skipItem, { scheduleId, itemId: items[0].id, reason: 'Too late' }),
      'schedules.invoiced',
    );
  });

  it('sends on its own only when the schedule says so', async () => {
    const scheduleId = await finance.as.mutation(api.billingSchedules.create, {
      projectId,
      items: halves,
      autoSend: true,
    });
    await finance.as.mutation(api.billingSchedules.activate, { scheduleId });
    await t.mutation(internal.billingSchedules.onDocumentSigned, { documentId: await signedContract() });

    const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
    expect(scheduled.some((job) => job.name.includes('invoiceSending'))).toBe(true);
    expect(await t.run((ctx) => ctx.db.query('notifications').collect())).toEqual([]);
  });

  it('tells the people who send invoices when one is waiting for them', async () => {
    const scheduleId = await finance.as.mutation(api.billingSchedules.create, { projectId, items: halves });
    await finance.as.mutation(api.billingSchedules.activate, { scheduleId });
    await t.mutation(internal.billingSchedules.onDocumentSigned, { documentId: await signedContract() });

    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notifications.map((row) => row.recipientId)).toContain(finance.memberId);
    expect(notifications[0]).toMatchObject({
      event: 'invoice_ready_to_send',
      title: 'On signature is ready to invoice',
    });
  });

  it('keeps schedules to the people who handle money', async () => {
    await expectCode(dayo.as.mutation(api.billingSchedules.create, { projectId, items: halves }), 'auth.forbidden');
    await expectCode(pm.as.mutation(api.billingSchedules.create, { projectId, items: halves }), 'auth.forbidden');
    await expectCode(dayo.as.query(api.billingSchedules.forProject, { projectId }), 'auth.forbidden');
  });
});
