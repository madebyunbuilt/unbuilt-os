import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, type TestConvex } from './test.auth';

// Change requests (06-projects.md, Change requests). What matters here: a change request reaches the client once and
// takes its number then; an approval moves the project's budget and due date and bills the amount exactly once; above
// the studio's threshold only a signature approves it; and a decline leaves the project alone.

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
  vi.setSystemTime(Date.parse('2026-09-23T09:00:00Z'));
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
    dueDate: '2026-12-01',
    budgetMinor: BUDGET,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const smallChange = {
  title: 'A second onboarding screen',
  description: 'One more screen in the onboarding flow, with its own illustration.',
  reason: 'The client added a step after user testing.',
  amountMinor: 200_000_00,
  days: 5,
};

const project = () => t.run((ctx) => ctx.db.get('projects', projectId));
const invoices = () => t.run((ctx) => ctx.db.query('invoices').collect());
const changeRequest = (id: Id<'changeRequests'>) => t.run((ctx) => ctx.db.get('changeRequests', id));

describe('change requests', () => {
  it('takes its number and generates its document when it goes to the client', async () => {
    const id = await pm.as.mutation(api.changeRequests.create, { projectId, ...smallChange });
    const draft = await pm.as.query(api.changeRequests.get, { changeRequestId: id });
    // It takes its number when it goes out, not before, so an abandoned draft burns none.
    expect(draft?.number).toBeUndefined();
    expect(draft).toMatchObject({
      status: 'draft',
      billing: 'invoice_now',
      impact: { amountMinor: 200_000_00, currency: 'NGN', days: 5 },
    });

    const sent = await pm.as.mutation(api.changeRequests.send, { changeRequestId: id });
    expect(sent.number).toBe('UNB-CR-0001');
    const document = await t.run((ctx) => ctx.db.get('documents', sent.documentId));
    expect(document).toMatchObject({
      type: 'change_request',
      projectId,
      clientId,
      title: 'UNB-CR-0001: A second onboarding screen',
    });
    expect(document?.lineItems?.[0]).toMatchObject({ amountMinor: 200_000_00 });
    // Under the threshold, so the client can simply approve it.
    expect(await changeRequest(id)).toMatchObject({ status: 'sent', needsSignature: false });
    // A draft that has gone out is no longer edited or deleted.
    await expectCode(
      pm.as.mutation(api.changeRequests.update, { changeRequestId: id, ...smallChange }),
      'changeRequests.sent',
    );
    await expectCode(pm.as.mutation(api.changeRequests.remove, { changeRequestId: id }), 'changeRequests.sent');
  });

  it('moves the budget and the due date and drafts the invoice, exactly once', async () => {
    const id = await pm.as.mutation(api.changeRequests.create, { projectId, ...smallChange });
    await pm.as.mutation(api.changeRequests.send, { changeRequestId: id });

    const decided = await pm.as.mutation(api.changeRequests.recordDecision, {
      changeRequestId: id,
      decision: 'approved',
      contactId,
    });
    expect(decided.invoiceId).not.toBeNull();
    expect(await project()).toMatchObject({ budgetMinor: BUDGET + 200_000_00, dueDate: '2026-12-06' });
    const raised = await invoices();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ type: 'change_request', status: 'draft' });
    expect(raised[0].lineItems[0].description).toBe('UNB-CR-0001: A second onboarding screen');
    expect(await changeRequest(id)).toMatchObject({ status: 'approved', appliedAt: Date.now() });

    // A second decision changes nothing: the budget moved once and one invoice exists.
    await expectCode(
      pm.as.mutation(api.changeRequests.recordDecision, { changeRequestId: id, decision: 'approved', contactId }),
      'changeRequests.decided',
    );
    expect(await project()).toMatchObject({ budgetMinor: BUDGET + 200_000_00 });
    expect(await invoices()).toHaveLength(1);
  });

  it('joins the billing schedule instead when that is what it says, and the schedule still adds up', async () => {
    const scheduleId = await finance.as.mutation(api.billingSchedules.create, {
      projectId,
      items: [
        { label: 'On signature', kind: 'percent', bps: 5_000, trigger: 'on_signature' },
        { label: 'On final approval', kind: 'percent', bps: 5_000, trigger: 'on_milestone_approved' },
      ],
    });
    await finance.as.mutation(api.billingSchedules.activate, { scheduleId });

    const id = await pm.as.mutation(api.changeRequests.create, {
      projectId,
      ...smallChange,
      billing: 'with_the_schedule',
    });
    await pm.as.mutation(api.changeRequests.send, { changeRequestId: id });
    await pm.as.mutation(api.changeRequests.recordDecision, { changeRequestId: id, decision: 'approved', contactId });

    // Nothing is invoiced yet: the amount waits on the schedule.
    expect(await invoices()).toHaveLength(0);
    const schedule = await finance.as.query(api.billingSchedules.forProject, { projectId });
    expect(schedule).toMatchObject({ amountMinor: BUDGET + 200_000_00, scheduledMinor: BUDGET + 200_000_00 });
    expect(schedule?.items.at(-1)).toMatchObject({
      label: 'UNB-CR-0001: A second onboarding screen',
      amountMinor: 200_000_00,
      status: 'pending',
    });
  });

  it('bills a change request now when the project has no schedule to join', async () => {
    const id = await pm.as.mutation(api.changeRequests.create, {
      projectId,
      ...smallChange,
      billing: 'with_the_schedule',
    });
    await pm.as.mutation(api.changeRequests.send, { changeRequestId: id });
    await pm.as.mutation(api.changeRequests.recordDecision, { changeRequestId: id, decision: 'approved', contactId });
    expect(await invoices()).toHaveLength(1);
  });

  it('is approved by the signature alone above the studio’s threshold', async () => {
    const big = { ...smallChange, amountMinor: 600_000_00 };
    const id = await pm.as.mutation(api.changeRequests.create, { projectId, ...big });
    const { documentId } = await pm.as.mutation(api.changeRequests.send, { changeRequestId: id });
    expect(await changeRequest(id)).toMatchObject({ needsSignature: true });

    await expectCode(
      pm.as.mutation(api.changeRequests.recordDecision, { changeRequestId: id, decision: 'approved', contactId }),
      'changeRequests.needsSignature',
    );
    expect(await project()).toMatchObject({ budgetMinor: BUDGET });

    // The signature itself is the approval.
    await t.mutation(internal.changeRequests.onDocumentSigned, { documentId });
    expect(await changeRequest(id)).toMatchObject({ status: 'approved' });
    expect(await project()).toMatchObject({ budgetMinor: BUDGET + 600_000_00 });
    // Signed again (a replay) changes nothing.
    await t.mutation(internal.changeRequests.onDocumentSigned, { documentId });
    expect(await project()).toMatchObject({ budgetMinor: BUDGET + 600_000_00 });
  });

  it('follows the client’s own rule when they have one', async () => {
    await t.run((ctx) => ctx.db.patch('clients', clientId, { changeRequestSignature: 'never' }));
    const id = await pm.as.mutation(api.changeRequests.create, {
      projectId,
      ...smallChange,
      amountMinor: 900_000_00,
    });
    await pm.as.mutation(api.changeRequests.send, { changeRequestId: id });
    expect(await changeRequest(id)).toMatchObject({ needsSignature: false });
  });

  it('leaves the project alone when it is declined or withdrawn', async () => {
    const declined = await pm.as.mutation(api.changeRequests.create, { projectId, ...smallChange });
    await pm.as.mutation(api.changeRequests.send, { changeRequestId: declined });
    await pm.as.mutation(api.changeRequests.recordDecision, {
      changeRequestId: declined,
      decision: 'declined',
      contactId,
      reason: 'Too expensive for now',
    });
    expect(await changeRequest(declined)).toMatchObject({
      status: 'declined',
      declineReason: 'Too expensive for now',
    });

    const withdrawn = await pm.as.mutation(api.changeRequests.create, { projectId, ...smallChange });
    await pm.as.mutation(api.changeRequests.send, { changeRequestId: withdrawn });
    await pm.as.mutation(api.changeRequests.withdraw, {
      changeRequestId: withdrawn,
      reason: 'Agreed to fold it into the next phase',
    });
    expect(await changeRequest(withdrawn)).toMatchObject({ status: 'withdrawn' });

    expect(await project()).toMatchObject({ budgetMinor: BUDGET, dueDate: '2026-12-01' });
    expect(await invoices()).toHaveLength(0);
  });

  it('refuses a change request with no impact, and a decision before it is sent', async () => {
    const nothing = await pm.as.mutation(api.changeRequests.create, {
      projectId,
      ...smallChange,
      amountMinor: 0,
      days: 0,
    });
    await expectCode(pm.as.mutation(api.changeRequests.send, { changeRequestId: nothing }), 'changeRequests.noImpact');
    await expectCode(
      pm.as.mutation(api.changeRequests.recordDecision, { changeRequestId: nothing, decision: 'approved', contactId }),
      'changeRequests.notSent',
    );
  });

  it('keeps change requests to the people who run projects', async () => {
    const id = await pm.as.mutation(api.changeRequests.create, { projectId, ...smallChange });
    await expectCode(dayo.as.mutation(api.changeRequests.create, { projectId, ...smallChange }), 'auth.forbidden');
    await expectCode(dayo.as.mutation(api.changeRequests.send, { changeRequestId: id }), 'auth.forbidden');
    await expectCode(dayo.as.query(api.changeRequests.get, { changeRequestId: id }), 'projects.notFound');
  });
});
