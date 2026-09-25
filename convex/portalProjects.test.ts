import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// A project in the portal (12-client-portal.md, Projects). What matters here: the client decides on their own work
// and nobody else's, the decision writes the same record the studio's own path writes, and nothing internal — costs,
// rates, who logged what time — is in the answer at all.

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
let dayo: Awaited<ReturnType<typeof createTeamMember>>;
let glossup: Awaited<ReturnType<typeof createClientUser>>;
let qravit: Awaited<ReturnType<typeof createClientUser>>;
let projectId: Id<'projects'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-24T09:00:00Z'));
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  vi.stubEnv('FILE_URL_SECRET', 'test-file-url-secret-that-is-long-enough');
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio', name: 'Dayo Ade' });
  glossup = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  qravit = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
  projectId = await pm.as.mutation(api.projects.create, {
    clientId: glossup.clientId,
    name: 'Glossup app',
    type: 'mobile_app',
    billingModel: 'fixed',
    currency: 'NGN',
    startDate: '2026-09-01',
    budgetMinor: 1_000_000_00,
  });
  await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dayo.memberId });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A deliverable with a version submitted, which is what puts it in front of the client. */
async function inReview(title = 'Onboarding flow') {
  const deliverableId = await pm.as.mutation(api.deliverables.create, { projectId, title });
  await pm.as.mutation(api.deliverables.submitVersion, {
    deliverableId,
    uploads: [],
    links: [{ url: 'figma.com/flows', label: 'Figma' }],
    notes: 'First pass',
  });
  return deliverableId;
}

describe('what a client sees on their project', () => {
  it('shows work waiting for them, and nothing the studio is still writing', async () => {
    const reviewing = await inReview();
    // A deliverable with no version yet is the studio's own.
    await pm.as.mutation(api.deliverables.create, { projectId, title: 'Not started' });

    const view = await glossup.as.query(api.portalProjects.project, { projectId });
    expect(view?.deliverables).toHaveLength(1);
    expect(view?.deliverables[0]).toMatchObject({
      id: reviewing,
      title: 'Onboarding flow',
      version: 1,
      needsYou: true,
      notes: 'First pass',
    });
    // Submitting normalises the link, so what the client is given is something their browser will open.
    expect(view?.deliverables[0].links[0]).toMatchObject({ url: 'https://figma.com/flows', label: 'Figma' });
  });

  it('keeps the studio’s own figures out of the answer', async () => {
    await inReview();
    await t.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        memberId: dayo.memberId,
        projectId,
        date: '2026-09-10',
        weekStart: '2026-09-07',
        minutes: 120,
        description: 'Internal note nobody outside should read',
        billable: true,
        status: 'approved',
        costRateMinor: 50_000_00,
        billRateMinor: 90_000_00,
      });
    });

    const view = await glossup.as.query(api.portalProjects.project, { projectId });
    const sent = JSON.stringify(view);
    expect(sent).not.toContain('budget');
    expect(sent).not.toContain('costRate');
    expect(sent).not.toContain('billRate');
    expect(sent).not.toContain('Internal note');
  });

  it('does not find another client’s project', async () => {
    expect(await qravit.as.query(api.portalProjects.project, { projectId })).toBeNull();
  });
});

describe('deciding on a deliverable', () => {
  it('approves it against the contact who approved it', async () => {
    const deliverableId = await inReview();
    expect(
      await glossup.as.mutation(api.portalProjects.decideDeliverable, {
        deliverableId,
        version: 1,
        decision: 'approved',
      }),
    ).toMatchObject({ milestoneApproved: null });

    expect(await t.run((ctx) => ctx.db.get('deliverables', deliverableId))).toMatchObject({
      status: 'approved',
      approvedByContactId: glossup.contactId,
      approvedVersion: 1,
    });
  });

  it('asks for changes, and lets the studio send another version', async () => {
    const deliverableId = await inReview();
    await glossup.as.mutation(api.portalProjects.decideDeliverable, {
      deliverableId,
      version: 1,
      decision: 'changes_requested',
    });
    expect(await t.run((ctx) => ctx.db.get('deliverables', deliverableId))).toMatchObject({
      status: 'changes_requested',
    });
    await pm.as.mutation(api.deliverables.submitVersion, {
      deliverableId,
      uploads: [],
      links: [{ url: 'figma.com/flows-v2' }],
    });
    const view = await glossup.as.query(api.portalProjects.project, { projectId });
    expect(view?.deliverables[0]).toMatchObject({ version: 2, needsYou: true });
  });

  it('refuses a version that has already been replaced', async () => {
    const deliverableId = await inReview();
    await pm.as.mutation(api.deliverables.submitVersion, { deliverableId, uploads: [], links: [{ url: 'x.com' }] });
    await expectCode(
      glossup.as.mutation(api.portalProjects.decideDeliverable, {
        deliverableId,
        version: 1,
        decision: 'approved',
      }),
      'projects.staleVersion',
    );
  });

  it('closes the milestone when the last deliverable in it is approved', async () => {
    const milestoneId = await pm.as.mutation(api.milestones.create, { projectId, name: 'Discovery' });
    const deliverableId = await pm.as.mutation(api.deliverables.create, {
      projectId,
      title: 'Only one',
      milestoneId,
    });
    await pm.as.mutation(api.deliverables.submitVersion, { deliverableId, uploads: [], links: [{ url: 'x.com' }] });

    const result = await glossup.as.mutation(api.portalProjects.decideDeliverable, {
      deliverableId,
      version: 1,
      decision: 'approved',
    });
    expect(result.milestoneApproved).toBe(milestoneId);
    expect(await t.run((ctx) => ctx.db.get('milestones', milestoneId))).toMatchObject({
      status: 'approved',
      approvedByContactId: glossup.contactId,
    });
  });

  it('is not another client’s to decide', async () => {
    const deliverableId = await inReview();
    await expectCode(
      qravit.as.mutation(api.portalProjects.decideDeliverable, {
        deliverableId,
        version: 1,
        decision: 'approved',
      }),
      'projects.notFound',
    );
  });
});

describe('deciding on a change request', () => {
  async function sentChangeRequest(amountMinor = 200_000_00) {
    const changeRequestId = await pm.as.mutation(api.changeRequests.create, {
      projectId,
      title: 'A second onboarding screen',
      description: 'One more screen.',
      reason: 'User testing.',
      amountMinor,
      days: 5,
    });
    await pm.as.mutation(api.changeRequests.send, { changeRequestId });
    return changeRequestId;
  }

  it('approves it, moving the budget and the due date once', async () => {
    const changeRequestId = await sentChangeRequest();
    const { invoiceId } = await glossup.as.mutation(api.portalProjects.decideChangeRequest, {
      changeRequestId,
      decision: 'approved',
    });
    expect(invoiceId).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get('projects', projectId))).toMatchObject({
      budgetMinor: 1_200_000_00,
    });
    expect(await t.run((ctx) => ctx.db.get('changeRequests', changeRequestId))).toMatchObject({
      status: 'approved',
      decidedByContactId: glossup.contactId,
    });
    // Deciding twice changes nothing.
    await expectCode(
      glossup.as.mutation(api.portalProjects.decideChangeRequest, { changeRequestId, decision: 'approved' }),
      'changeRequests.decided',
    );
  });

  it('sends them to sign when the change is above the studio’s threshold', async () => {
    const changeRequestId = await sentChangeRequest(600_000_00);
    await expectCode(
      glossup.as.mutation(api.portalProjects.decideChangeRequest, { changeRequestId, decision: 'approved' }),
      'projects.needsSignature',
    );
    // Declining one is still theirs to do without signing anything.
    await glossup.as.mutation(api.portalProjects.decideChangeRequest, {
      changeRequestId,
      decision: 'declined',
      reason: 'Too much for now',
    });
    expect(await t.run((ctx) => ctx.db.get('changeRequests', changeRequestId))).toMatchObject({ status: 'declined' });
  });

  it('is not open to a client member, who cannot approve changes', async () => {
    const changeRequestId = await sentChangeRequest();
    const member = await createClientUser(t, roles.client_member, {
      clientName: 'unused',
      email: 'junior@glossup.com',
    });
    await t.run(async (ctx) => ctx.db.patch('contacts', member.contactId, { clientId: glossup.clientId }));
    await expectCode(
      member.as.mutation(api.portalProjects.decideChangeRequest, { changeRequestId, decision: 'approved' }),
      'auth.forbidden',
    );
    // Reviewing deliverables is theirs, though.
    const deliverableId = await inReview('For the member');
    await member.as.mutation(api.portalProjects.decideDeliverable, {
      deliverableId,
      version: 1,
      decision: 'approved',
    });
  });
});

describe('retainer hours in the portal', () => {
  it('shows the hours and nothing about what they cost', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'funmi@unbuilt.studio' });
    await finance.as.mutation(api.retainers.create, {
      projectId,
      startDate: '2026-09-01',
      monthlyFeeMinor: 500_000_00,
      includedMinutes: 600,
      overageRateMinor: 25_000_00,
      invoiceDayOfMonth: 1,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        memberId: dayo.memberId,
        projectId,
        date: '2026-09-10',
        weekStart: '2026-09-07',
        minutes: 300,
        description: 'Support',
        billable: true,
        status: 'approved',
      });
    });

    const view = await glossup.as.query(api.portalProjects.project, { projectId });
    expect(view?.retainer).toMatchObject({ includedMinutes: 600, usedMinutes: 300, remainingMinutes: 300 });
    // The fee and the overage rate are the studio's side of the arrangement.
    expect(JSON.stringify(view?.retainer)).not.toContain('50000000');
    expect(JSON.stringify(view?.retainer)).not.toContain('overageRate');
  });
});
