import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, components } from '../_generated/api';
import { type Id } from '../_generated/dataModel';
import { createClientUser, createTeamMember, newTest, seedRoles, type TestConvex } from '../test.auth';
import { REDACTED } from './audit';
import { revokeAllSessions, TEAM_SESSION_IDLE_MS } from './principals';

const fixture = <T extends 'query' | 'mutation' | 'action'>(type: T, name: string) =>
  makeFunctionReference<T>(`lib/functions.fixtures:${name}`);

const teamRead = fixture('query', 'teamRead');
const teamRename = fixture('mutation', 'teamRename');
const teamCreateThenDelete = fixture('mutation', 'teamCreateThenDelete');
const teamSetCostRate = fixture('mutation', 'teamSetCostRate');
const teamTamperWithAudit = fixture('mutation', 'teamTamperWithAudit');
const teamActionRead = fixture('action', 'teamActionRead');
const portalOwnClient = fixture('query', 'portalOwnClient');
const portalContact = fixture('query', 'portalContact');
const portalInvoicesOnly = fixture('query', 'portalInvoicesOnly');
const portalSetJobTitle = fixture('mutation', 'portalSetJobTitle');
const whoAmI = fixture('query', 'whoAmI');

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

beforeEach(async () => {
  t = newTest();
  roles = await seedRoles(t);
});

const insertClient = (displayName: string) =>
  t.run((ctx) =>
    ctx.db.insert('clients', {
      displayName,
      kind: 'company',
      status: 'active',
      defaultCurrency: 'NGN',
      timezone: 'Africa/Lagos',
      portalEnabled: true,
    }),
  );

describe('teamQuery', () => {
  it('rejects a caller with no session', async () => {
    await expectCode(t.query(teamRead, {}), 'auth.unauthenticated');
  });

  it('allows an active member whose role holds the permission', async () => {
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    expect(await pm.as.query(teamRead, {})).toEqual({ memberId: pm.memberId, canDelete: false });
  });

  it('rejects a member whose role lacks the permission', async () => {
    const editor = await createTeamMember(t, roles.content_editor, { email: 'editor@unbuilt.studio' });
    await expectCode(editor.as.query(teamRead, {}), 'auth.forbidden');
  });

  it('rejects a member without two-factor authentication', async () => {
    const pm = await createTeamMember(t, roles.admin, { email: 'new@unbuilt.studio' }, { twoFactorEnabled: false });
    await expectCode(pm.as.query(teamRead, {}), 'auth.twoFactorRequired');
    // Setting up 2FA only needs the session itself.
    expect(await pm.as.query(whoAmI, {})).toBe('new@unbuilt.studio');
  });

  it.each(['invited', 'suspended', 'offboarded'] as const)('rejects a %s member', async (status) => {
    const member = await createTeamMember(t, roles.admin, { email: `${status}@unbuilt.studio`, status });
    await expectCode(member.as.query(teamRead, {}), 'auth.forbidden');
  });

  it('rejects a team session with no real use for 12 hours, even though token renewals kept it refreshed', async () => {
    const idleSince = Date.now() - TEAM_SESSION_IDLE_MS - 60_000;
    const member = await createTeamMember(t, roles.admin, { email: 'idle@unbuilt.studio' }, { signedInAt: idleSince });
    await expectCode(member.as.query(teamRead, {}), 'auth.sessionExpired');
    await expectCode(member.as.mutation(api.sessionActivity.record, {}), 'auth.sessionExpired');
  });

  it('keeps a long session alive while the person keeps using the app', async () => {
    const signedInAt = Date.now() - TEAM_SESSION_IDLE_MS - 60_000;
    const member = await createTeamMember(t, roles.admin, { email: 'busy@unbuilt.studio' }, { signedInAt });
    await t.run((ctx) =>
      ctx.db.insert('sessionActivity', {
        sessionId: member.sessionId,
        authUserId: member.authUserId,
        lastActiveAt: Date.now() - 60 * 60_000,
      }),
    );
    expect(await member.as.query(teamRead, {})).toBeTruthy();
  });

  it('rejects a client user', async () => {
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(client.as.query(teamRead, {}), 'auth.forbidden');
  });

  it('rejects a revoked session on the next request', async () => {
    const member = await createTeamMember(t, roles.admin, { email: 'leaving@unbuilt.studio' });
    await member.as.query(teamRead, {});
    await t.run((ctx) => revokeAllSessions(ctx, member.authUserId));
    await expectCode(member.as.query(teamRead, {}), 'auth.unauthenticated');
  });

  it('rejects an expired session', async () => {
    const member = await createTeamMember(t, roles.admin, { email: 'expired@unbuilt.studio' });
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: 'session',
          where: [{ field: '_id', value: member.sessionId }],
          update: { expiresAt: Date.now() - 1 },
        },
      }),
    );
    await expectCode(member.as.query(teamRead, {}), 'auth.unauthenticated');
  });

  it('rejects an identity whose session belongs to someone else', async () => {
    const a = await createTeamMember(t, roles.admin, { email: 'a@unbuilt.studio' });
    const b = await createTeamMember(t, roles.admin, { email: 'b@unbuilt.studio' });
    const forged = t.withIdentity({ subject: b.authUserId, sessionId: a.sessionId });
    await expectCode(forged.query(teamRead, {}), 'auth.unauthenticated');
  });
});

describe('teamMutation', () => {
  it('writes exactly one audit entry per write, with actor, permission and field diff', async () => {
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    const clientId = await insertClient('Glossup');

    await pm.as.mutation(teamRename, { clientId, displayName: 'Glossup Ltd' });

    const entries = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(entries).toEqual([
      expect.objectContaining({
        actorKind: 'team',
        actorId: pm.memberId,
        authUserId: pm.authUserId,
        permission: 'clients.update',
        action: 'update',
        table: 'clients',
        recordId: clientId,
        diff: { before: { displayName: 'Glossup' }, after: { displayName: 'Glossup Ltd' } },
        ip: '203.0.113.7',
        userAgent: 'vitest',
      }),
    ]);
  });

  it('audits inserts and deletes separately', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const clientId = await admin.as.mutation(teamCreateThenDelete, {});
    const entries = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(entries.map((entry) => [entry.action, entry.recordId])).toEqual([
      ['insert', clientId],
      ['delete', clientId],
    ]);
    expect(entries[0].diff.after).toMatchObject({ displayName: 'Temporary' });
    expect(entries[1].diff.before).toMatchObject({ displayName: 'Temporary' });
  });

  it('writes nothing, audit included, when the caller is refused', async () => {
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });
    const clientId = await insertClient('Glossup');
    await expectCode(member.as.mutation(teamRename, { clientId, displayName: 'Hacked' }), 'auth.forbidden');
    expect(await t.run((ctx) => ctx.db.get('clients', clientId))).toMatchObject({ displayName: 'Glossup' });
    expect(await t.run((ctx) => ctx.db.query('auditLog').collect())).toEqual([]);
  });

  it('redacts sensitive fields in the diff', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    await admin.as.mutation(teamSetCostRate, { memberId: admin.memberId, costRateMinor: 1_500_000 });
    const [entry] = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(entry.diff).toEqual({ before: {}, after: { costRateMinor: REDACTED } });
  });

  it('refuses to insert or delete audit entries', async () => {
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    const clientId = await insertClient('Glossup');
    await pm.as.mutation(teamRename, { clientId, displayName: 'Glossup Ltd' });
    const [entry] = await t.run((ctx) => ctx.db.query('auditLog').collect());

    await expectCode(pm.as.mutation(teamTamperWithAudit, {}), 'audit.appendOnly');
    await expectCode(pm.as.mutation(teamTamperWithAudit, { entryId: entry._id }), 'audit.appendOnly');
    expect(await t.run((ctx) => ctx.db.query('auditLog').collect())).toHaveLength(1);
  });
});

describe('teamAction', () => {
  it('resolves the principal through an internal query', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    expect(await finance.as.action(teamActionRead, {})).toEqual({ memberId: finance.memberId, roleKey: 'finance' });
  });

  it('rejects callers without the permission', async () => {
    const editor = await createTeamMember(t, roles.content_editor, { email: 'editor@unbuilt.studio' });
    await expectCode(editor.as.action(teamActionRead, {}), 'auth.forbidden');
    await expectCode(t.action(teamActionRead, {}), 'auth.unauthenticated');
  });
});

describe('portalQuery and portalMutation with two clients', () => {
  let glossup: Awaited<ReturnType<typeof createClientUser>>;
  let qravit: Awaited<ReturnType<typeof createClientUser>>;

  beforeEach(async () => {
    glossup = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    qravit = await createClientUser(t, roles.client_member, { clientName: 'Qravit', email: 'tunde@qravit.io' });
  });

  it('scopes reads to the caller’s own client', async () => {
    expect(await glossup.as.query(portalOwnClient, {})).toBe('Glossup');
    expect(await qravit.as.query(portalOwnClient, {})).toBe('Qravit');
  });

  it('returns not found for another client’s record, even with its id', async () => {
    expect(await glossup.as.query(portalContact, { contactId: glossup.contactId })).toBe('ada@glossup.com');
    expect(await glossup.as.query(portalContact, { contactId: qravit.contactId })).toBeNull();
    expect(await qravit.as.query(portalContact, { contactId: glossup.contactId })).toBeNull();
  });

  it('applies the client role', async () => {
    expect(await glossup.as.query(portalInvoicesOnly, {})).toBe('invoices');
    await expectCode(qravit.as.query(portalInvoicesOnly, {}), 'auth.forbidden');
  });

  it('rejects team members', async () => {
    const owner = await createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio' });
    await expectCode(owner.as.query(portalOwnClient, {}), 'auth.forbidden');
  });

  it('rejects contacts who left, lost portal access, or whose client has the portal off', async () => {
    await t.run((ctx) => ctx.db.patch('contacts', glossup.contactId, { status: 'left' }));
    await expectCode(glossup.as.query(portalOwnClient, {}), 'auth.forbidden');

    await t.run((ctx) => ctx.db.patch('contacts', qravit.contactId, { portalAccess: false }));
    await expectCode(qravit.as.query(portalOwnClient, {}), 'auth.forbidden');

    const closed = await createClientUser(t, roles.client_admin, {
      clientName: 'Orrery',
      email: 'kemi@orrery.app',
      portalEnabled: false,
    });
    await expectCode(closed.as.query(portalOwnClient, {}), 'auth.forbidden');
  });

  it('audits portal writes as the client user', async () => {
    await qravit.as.mutation(portalSetJobTitle, { jobTitle: 'CTO' });
    const entries = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(entries).toEqual([
      expect.objectContaining({
        actorKind: 'client',
        actorId: qravit.contactId,
        permission: 'portal.files.upload',
        table: 'contacts',
        recordId: qravit.contactId as Id<'contacts'>,
        diff: { before: {}, after: { jobTitle: 'CTO' } },
      }),
    ]);
  });
});
