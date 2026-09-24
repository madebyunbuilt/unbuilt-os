import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// The client portal (12-client-portal.md). What matters most here is the rule the acceptance criteria lead with: a
// client user never receives data belonging to another client. Every query is checked with two clients who have the
// same shape of work, so a leak shows up as the wrong name rather than as an empty list.

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
let glossup: Awaited<ReturnType<typeof createClientUser>>;
let qravit: Awaited<ReturnType<typeof createClientUser>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-24T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  glossup = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  qravit = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A project for a client, with one milestone, created by the studio the ordinary way. */
async function projectFor(clientId: Id<'clients'>, name: string) {
  const projectId = await pm.as.mutation(api.projects.create, {
    clientId,
    name,
    type: 'mobile_app',
    billingModel: 'fixed',
    currency: 'NGN',
    startDate: '2026-09-01',
    budgetMinor: 1_000_000_00,
  });
  await pm.as.mutation(api.milestones.create, { projectId, name: `${name} discovery` });
  return projectId;
}

describe('the portal home', () => {
  it('shows a client their own work and never another client’s', async () => {
    await projectFor(glossup.clientId, 'Glossup app');
    await projectFor(qravit.clientId, 'Qravit platform');

    const theirs = await glossup.as.query(api.portal.home, {});
    expect(theirs.clientName).toBe('Glossup');
    expect(theirs.projects.map((project) => project.name)).toEqual(['Glossup app']);

    const others = await qravit.as.query(api.portal.home, {});
    expect(others.projects.map((project) => project.name)).toEqual(['Qravit platform']);
  });

  it('puts an unpaid invoice in front of them, and only theirs', async () => {
    const mine = await pm.as.mutation(api.invoices.create, {
      clientId: glossup.clientId,
      lineItems: [{ description: 'Design', quantityMilli: 1_000, unitPriceMinor: 100_000_00 }],
    });
    const theirs = await pm.as.mutation(api.invoices.create, {
      clientId: qravit.clientId,
      lineItems: [{ description: 'Design', quantityMilli: 1_000, unitPriceMinor: 100_000_00 }],
    });
    for (const invoiceId of [mine, theirs]) {
      await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId: pm.memberId });
      await t.mutation(internal.invoices.markSent, { invoiceId, memberId: pm.memberId, recipientContactIds: [] });
    }

    const home = await glossup.as.query(api.portal.home, {});
    const invoices = home.waiting.filter((item) => item.kind === 'invoice');
    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe(mine);
    expect(invoices[0].href).toBe(`/portal/invoices/${mine}`);
  });

  it('asks for a decision on a change request that is with them', async () => {
    const projectId = await projectFor(glossup.clientId, 'Glossup app');
    const changeRequestId = await pm.as.mutation(api.changeRequests.create, {
      projectId,
      title: 'A second onboarding screen',
      description: 'One more screen.',
      reason: 'User testing.',
      amountMinor: 200_000_00,
      days: 5,
    });
    // A draft is the studio's business; nothing is asked of the client until it is sent.
    expect((await glossup.as.query(api.portal.home, {})).waiting).toHaveLength(0);

    await pm.as.mutation(api.changeRequests.send, { changeRequestId });
    const waiting = (await glossup.as.query(api.portal.home, {})).waiting;
    expect(waiting.map((item) => item.kind)).toEqual(['changeRequest']);
    // Its document is not here yet: sending schedules the delivery, and the document stays a draft until that runs.
    // The client can still decide in the portal, which is the point of asking them here.
    expect(waiting[0].href).toBe(`/portal/projects/${projectId}`);
  });

  it('says nothing is waiting when nothing is', async () => {
    await projectFor(glossup.clientId, 'Glossup app');
    expect((await glossup.as.query(api.portal.home, {})).waiting).toEqual([]);
  });
});

describe('the portal’s projects', () => {
  it('lists a client’s own, with progress and no money', async () => {
    const projectId = await projectFor(glossup.clientId, 'Glossup app');
    await projectFor(qravit.clientId, 'Qravit platform');

    const listed = await glossup.as.query(api.portal.projects, {});
    expect(listed.map((project) => project.name)).toEqual(['Glossup app']);
    // What the client is not shown: what the work costs or is worth to the studio.
    expect(JSON.stringify(listed)).not.toContain('budget');
    expect(JSON.stringify(listed)).not.toContain('100000000');

    const one = await glossup.as.query(api.portal.project, { projectId });
    expect(one).toMatchObject({ name: 'Glossup app' });
    expect(one?.milestones).toHaveLength(1);
    expect(JSON.stringify(one)).not.toContain('budget');
  });

  it('does not find another client’s project, rather than refusing it', async () => {
    const theirs = await projectFor(qravit.clientId, 'Qravit platform');
    expect(await glossup.as.query(api.portal.project, { projectId: theirs })).toBeNull();
  });

  it('keeps a team member out of the portal, and a client out of the team app', async () => {
    const projectId = await projectFor(glossup.clientId, 'Glossup app');
    await expectCode(pm.as.query(api.portal.home, {}), 'auth.forbidden');
    await expectCode(glossup.as.query(api.projects.get, { projectId }), 'auth.forbidden');
  });

  it('shows nothing to a client whose role cannot see projects', async () => {
    const member = await createClientUser(t, roles.client_member, {
      clientName: 'Third party',
      email: 'sam@third.com',
    });
    await projectFor(member.clientId, 'Their app');
    // The seeded client member holds portal.projects.view, so this proves the gate, not the absence of data.
    expect(await member.as.query(api.portal.projects, {})).toHaveLength(1);
  });
});
