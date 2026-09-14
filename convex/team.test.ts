import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { REDACTED } from './lib/audit';
import { sendAuthEmail } from './lib/authEmails';
import { principalForEmail } from './lib/principals';
import { INVITE_TTL_MS } from './lib/team';
import {
  createAuthSession,
  createClientUser,
  createTeamMember,
  newTest,
  seedRoles,
  type TestConvex,
} from './test.auth';

vi.mock('./lib/authEmails', () => ({ sendAuthEmail: vi.fn() }));

const teamRead = makeFunctionReference<'query'>('lib/functions.fixtures:teamRead');

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
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(Date.parse('2026-09-14T09:00:00Z'));
  vi.stubEnv('APP_URL', 'https://os.unbuilt.studio');
  vi.mocked(sendAuthEmail).mockClear();
  t = newTest();
  roles = await seedRoles(t);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const newMember = (overrides: object = {}) => ({
  email: ' Dayo@Unbuilt.Studio ',
  roleId: roles.project_manager,
  name: 'Dayo Ade',
  title: 'Project manager',
  employmentType: 'employee' as const,
  timezone: 'Africa/Lagos',
  skills: ['Delivery', 'delivery ', ''],
  ...overrides,
});

const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

describe('team.invite', () => {
  it('creates an invited member with a 14-day invite, an onboarding checklist and an invitation email', async () => {
    const owner = await createTeamMember(t, roles.owner, { email: 'hello@unbuilt.studio', name: 'Unbuilt Studio' });
    const memberId = await owner.as.mutation(api.team.invite, newMember());
    await runScheduled();

    const member = await t.run((ctx) => ctx.db.get('teamMembers', memberId));
    expect(member).toMatchObject({
      email: 'dayo@unbuilt.studio',
      status: 'invited',
      skills: ['Delivery', 'delivery'],
      invitedByMemberId: owner.memberId,
      inviteExpiresAt: Date.now() + INVITE_TTL_MS,
    });
    expect(member?.inviteLastSentAt).toBeTypeOf('number');

    expect(vi.mocked(sendAuthEmail)).toHaveBeenCalledWith({
      kind: 'invitation',
      to: 'dayo@unbuilt.studio',
      url: 'https://os.unbuilt.studio/sign-in?email=dayo%40unbuilt.studio',
      inviterName: 'Unbuilt Studio',
      roleName: 'Project manager',
      expiresAt: Date.now() + INVITE_TTL_MS,
    });

    const profile = await owner.as.query(api.team.get, { memberId });
    expect(profile.invite).toBe('pending');
    expect(profile.onboarding?.items.map((item) => [item.label, item.done, item.automatic])).toEqual([
      ['NDA signed', false, false],
      ['Agreement signed', false, false],
      ['2FA enabled', false, true],
      ['Added to projects', false, false],
      ['Tools access granted', false, false],
    ]);
  });

  it('refuses addresses already on the team or belonging to a client contact', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    await admin.as.mutation(api.team.invite, newMember());
    await expectCode(admin.as.mutation(api.team.invite, newMember()), 'team.exists');
    await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(admin.as.mutation(api.team.invite, newMember({ email: 'ada@glossup.com' })), 'team.clientEmail');
  });

  it('never invites a second Owner or into a role more powerful than the inviter’s', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    await expectCode(admin.as.mutation(api.team.invite, newMember({ roleId: roles.owner })), 'team.ownerRole');
    await expectCode(admin.as.mutation(api.team.invite, newMember({ roleId: roles.client_admin })), 'team.invalidRole');

    const hrRole = await t.run((ctx) =>
      ctx.db.insert('roles', {
        key: 'custom_hr',
        name: 'HR',
        kind: 'team',
        permissions: ['team.view', 'team.manage'],
        isSystem: false,
        description: '',
      }),
    );
    const hr = await createTeamMember(t, hrRole, { email: 'hr@unbuilt.studio' });
    await expectCode(hr.as.mutation(api.team.invite, newMember({ roleId: roles.admin })), 'team.cannotGrant');
    expect(
      await hr.as.mutation(api.team.invite, newMember({ roleId: hrRole, email: 'hr2@unbuilt.studio' })),
    ).toBeTruthy();
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }],
    ['a local phone number', { phone: '08012345678' }],
    ['an unknown timezone', { timezone: 'Lagos' }],
    ['an impossible start date', { startDate: '2026-02-30' }],
    ['a blank name', { name: '  ' }],
  ])('rejects %s', async (_, override) => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    await expectCode(admin.as.mutation(api.team.invite, newMember(override)), 'team.invalid');
  });

  it('requires team.manage', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(finance.as.mutation(api.team.invite, newMember()), 'auth.forbidden');
    await expectCode(client.as.mutation(api.team.invite, newMember()), 'auth.forbidden');
    await expectCode(t.mutation(api.team.invite, newMember()), 'auth.unauthenticated');
  });
});

describe('team.assignableRoles', () => {
  it('lists the team roles the caller could give, never the Owner or anything beyond their own role', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    expect((await admin.as.query(api.team.assignableRoles, {})).map((role) => role.key)).toEqual([
      'admin',
      'content_editor',
      'finance',
      'member',
      'project_manager',
    ]);

    const hrRole = await t.run((ctx) =>
      ctx.db.insert('roles', {
        key: 'custom_hr',
        name: 'HR',
        kind: 'team',
        permissions: ['team.view', 'team.manage', 'timeoff.request'],
        isSystem: false,
        description: '',
      }),
    );
    const hr = await createTeamMember(t, hrRole, { email: 'hr@unbuilt.studio' });
    expect((await hr.as.query(api.team.assignableRoles, {})).map((role) => role.key)).toEqual(['custom_hr']);

    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    await expectCode(finance.as.query(api.team.assignableRoles, {}), 'auth.forbidden');
  });
});

describe('invitation lifecycle', () => {
  it('stops working after 14 days and resending renews it', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const memberId = await admin.as.mutation(api.team.invite, newMember());
    const canSignUp = () => t.run(async (ctx) => (await principalForEmail(ctx, 'dayo@unbuilt.studio'))?.kind ?? null);

    expect(await canSignUp()).toBe('team');
    vi.setSystemTime(Date.now() + INVITE_TTL_MS + 1);
    expect(await canSignUp()).toBeNull();

    // The admin's earlier session has long expired; a fresh one resends.
    const laterAdmin = await createTeamMember(t, roles.admin, { email: 'admin2@unbuilt.studio' });
    expect((await laterAdmin.as.query(api.team.get, { memberId })).invite).toBe('expired');
    await laterAdmin.as.mutation(api.team.resendInvite, { memberId });
    await runScheduled();
    expect(await canSignUp()).toBe('team');
    expect(vi.mocked(sendAuthEmail)).toHaveBeenCalledTimes(2);
  });

  it('cancels an unaccepted invitation completely, but never an accepted one or the Owner’s', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const memberId = await admin.as.mutation(api.team.invite, newMember());
    await admin.as.mutation(api.team.cancelInvite, { memberId });
    expect(await t.run((ctx) => ctx.db.get('teamMembers', memberId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query('checklists').collect())).toEqual([]);

    const active = await createTeamMember(t, roles.member, { email: 'active@unbuilt.studio' });
    await expectCode(admin.as.mutation(api.team.cancelInvite, { memberId: active.memberId }), 'team.notInvited');
    await expectCode(admin.as.mutation(api.team.resendInvite, { memberId: active.memberId }), 'team.notInvited');

    const ownerInvite = await t.run((ctx) =>
      ctx.db.insert('teamMembers', {
        name: 'Owner',
        email: 'hello@unbuilt.studio',
        employmentType: 'employee',
        roleId: roles.owner,
        status: 'invited',
        timezone: 'Africa/Lagos',
        skills: [],
      }),
    );
    await expectCode(admin.as.mutation(api.team.cancelInvite, { memberId: ownerInvite }), 'team.owner');
  });
});

describe('viewing the team', () => {
  it('shows rates only to roles with team.rates.sensitive, and hides offboarded members by default', async () => {
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    const finance = await createTeamMember(t, roles.finance, {
      email: 'finance@unbuilt.studio',
      costRateMinor: 1_000_000,
      rateCurrency: 'NGN',
    });
    await createTeamMember(t, roles.member, { email: 'gone@unbuilt.studio', status: 'offboarded' });

    const seenByPm = await pm.as.query(api.team.list, {});
    expect(seenByPm.map((m) => m.email)).toEqual(['finance@unbuilt.studio', 'pm@unbuilt.studio']);
    expect(seenByPm.every((m) => !('rates' in m))).toBe(true);
    expect(await pm.as.query(api.team.get, { memberId: finance.memberId })).not.toHaveProperty('rates');

    const seenByFinance = await finance.as.query(api.team.list, { includeOffboarded: true });
    expect(seenByFinance).toHaveLength(3);
    expect(seenByFinance.find((m) => m.email === 'finance@unbuilt.studio')?.rates).toMatchObject({
      costRateMinor: 1_000_000,
    });
  });

  it('lets any member read their own profile, without rates, but not the team list', async () => {
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio', costRateMinor: 500 });
    const me = await member.as.query(api.team.me, {});
    expect(me).toMatchObject({ email: 'member@unbuilt.studio', role: { key: 'member' } });
    expect(me).not.toHaveProperty('rates');
    await expectCode(member.as.query(api.team.list, {}), 'auth.forbidden');
    await expectCode(member.as.query(api.team.get, { memberId: member.memberId }), 'auth.forbidden');
  });
});

describe('profiles', () => {
  it('lets team.manage edit a profile and members edit their own contact details', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });

    await admin.as.mutation(api.team.updateProfile, {
      memberId: member.memberId,
      name: 'Kemi Bello',
      employmentType: 'contractor',
      timezone: 'Europe/London',
      skills: ['Design'],
      capacityMinutesPerWeek: 20 * 60,
    });
    await member.as.mutation(api.team.updateMyProfile, {
      whatsapp: '+234 801 234 5678',
      timezone: 'Africa/Lagos',
      skills: ['Design', 'Figma'],
    });

    expect(await t.run((ctx) => ctx.db.get('teamMembers', member.memberId))).toMatchObject({
      name: 'Kemi Bello',
      employmentType: 'contractor',
      whatsapp: '+2348012345678',
      timezone: 'Africa/Lagos',
      skills: ['Design', 'Figma'],
      capacityMinutesPerWeek: 1200,
    });
    await expectCode(
      member.as.mutation(api.team.updateProfile, {
        memberId: admin.memberId,
        name: 'x',
        employmentType: 'employee',
        timezone: 'Africa/Lagos',
        skills: [],
      }),
      'auth.forbidden',
    );
  });
});

describe('roles and access', () => {
  it('changes another member’s role, but never your own, the Owner’s, or beyond your own power', async () => {
    const owner = await createTeamMember(t, roles.owner, { email: 'hello@unbuilt.studio' });
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });

    await admin.as.mutation(api.team.changeRole, { memberId: finance.memberId, roleId: roles.project_manager });
    expect((await t.run((ctx) => ctx.db.get('teamMembers', finance.memberId)))?.roleId).toBe(roles.project_manager);

    await expectCode(
      admin.as.mutation(api.team.changeRole, { memberId: admin.memberId, roleId: roles.member }),
      'team.self',
    );
    await expectCode(
      admin.as.mutation(api.team.changeRole, { memberId: owner.memberId, roleId: roles.member }),
      'team.owner',
    );
    await expectCode(
      admin.as.mutation(api.team.changeRole, { memberId: finance.memberId, roleId: roles.owner }),
      'team.ownerRole',
    );

    const hrRole = await t.run((ctx) =>
      ctx.db.insert('roles', {
        key: 'custom_hr',
        name: 'HR',
        kind: 'team',
        permissions: ['team.view', 'team.manage'],
        isSystem: false,
        description: '',
      }),
    );
    const hr = await createTeamMember(t, hrRole, { email: 'hr@unbuilt.studio' });
    await expectCode(
      hr.as.mutation(api.team.changeRole, { memberId: admin.memberId, roleId: hrRole }),
      'team.cannotGrant',
    );
  });

  it('sets rates for Finance, audited with the values redacted, and refuses negative rates', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });
    await finance.as.mutation(api.team.setRates, {
      memberId: member.memberId,
      costRateMinor: 750_000,
      billRateMinor: 1_500_000,
      currency: 'NGN',
    });
    const audit = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(audit.at(-1)?.diff.after).toMatchObject({ costRateMinor: REDACTED, billRateMinor: REDACTED });

    await expectCode(
      finance.as.mutation(api.team.setRates, { memberId: member.memberId, costRateMinor: -1, currency: 'NGN' }),
      'team.invalid',
    );
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    await expectCode(
      pm.as.mutation(api.team.setRates, { memberId: member.memberId, currency: 'NGN' }),
      'auth.forbidden',
    );
  });

  it('suspending ends sessions at once, and reactivating restores access', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const member = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    await member.as.query(teamRead, {});

    await admin.as.mutation(api.team.suspend, { memberId: member.memberId });
    await expectCode(member.as.query(teamRead, {}), 'auth.unauthenticated');

    await admin.as.mutation(api.team.reactivate, { memberId: member.memberId });
    const again = await createAuthSession(t, { email: 'finance-new-session@unbuilt.studio' });
    await t.run((ctx) => ctx.db.patch('teamMembers', member.memberId, { authUserId: again.authUserId }));
    expect(
      await t.withIdentity({ subject: again.authUserId, sessionId: again.sessionId }).query(teamRead, {}),
    ).toBeTruthy();

    await expectCode(admin.as.mutation(api.team.suspend, { memberId: admin.memberId }), 'team.self');
  });

  it('offboarding ends access immediately and keeps the record', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const leaving = await createTeamMember(t, roles.project_manager, { email: 'leaving@unbuilt.studio' });

    await admin.as.mutation(api.team.offboard, { memberId: leaving.memberId, endDate: '2026-09-30' });
    await expectCode(leaving.as.query(teamRead, {}), 'auth.unauthenticated');
    expect(await t.run((ctx) => ctx.db.get('teamMembers', leaving.memberId))).toMatchObject({
      status: 'offboarded',
      endDate: '2026-09-30',
      email: 'leaving@unbuilt.studio',
    });
    await expectCode(
      admin.as.mutation(api.team.offboard, { memberId: leaving.memberId, endDate: '2026-09-30' }),
      'team.offboarded',
    );

    const invited = await admin.as.mutation(api.team.invite, newMember());
    await expectCode(
      admin.as.mutation(api.team.offboard, { memberId: invited, endDate: '2026-09-30' }),
      'team.notActive',
    );
  });
});

describe('ownership transfer', () => {
  it('moves the Owner role to an active member with 2FA and makes the old Owner an Admin', async () => {
    const owner = await createTeamMember(t, roles.owner, { email: 'hello@unbuilt.studio' });
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });

    await owner.as.mutation(api.team.transferOwnership, { toMemberId: admin.memberId });
    const [oldOwner, newOwner] = await t.run(async (ctx) => [
      await ctx.db.get('teamMembers', owner.memberId),
      await ctx.db.get('teamMembers', admin.memberId),
    ]);
    expect(oldOwner?.roleId).toBe(roles.admin);
    expect(newOwner?.roleId).toBe(roles.owner);
    const owners = await t.run((ctx) =>
      ctx.db
        .query('teamMembers')
        .withIndex('by_role', (q) => q.eq('roleId', roles.owner))
        .collect(),
    );
    expect(owners).toHaveLength(1);
  });

  it('refuses targets without 2FA or not active, and callers who are not the Owner', async () => {
    const owner = await createTeamMember(t, roles.owner, { email: 'hello@unbuilt.studio' });
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const noTwoFactor = await createTeamMember(
      t,
      roles.member,
      { email: 'new@unbuilt.studio' },
      { twoFactorEnabled: false },
    );
    const suspended = await createTeamMember(t, roles.member, { email: 'sus@unbuilt.studio', status: 'suspended' });

    await expectCode(
      owner.as.mutation(api.team.transferOwnership, { toMemberId: noTwoFactor.memberId }),
      'team.twoFactor',
    );
    await expectCode(
      owner.as.mutation(api.team.transferOwnership, { toMemberId: suspended.memberId }),
      'team.notActive',
    );
    await expectCode(owner.as.mutation(api.team.transferOwnership, { toMemberId: owner.memberId }), 'team.self');
    await expectCode(admin.as.mutation(api.team.transferOwnership, { toMemberId: admin.memberId }), 'auth.forbidden');
  });
});

describe('onboarding checklist', () => {
  it('records who ticked an item, ticks 2FA automatically, and can be edited', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const memberId = await admin.as.mutation(api.team.invite, newMember());

    await admin.as.mutation(api.team.setChecklistItem, { memberId, index: 0, done: true });
    await expectCode(
      admin.as.mutation(api.team.setChecklistItem, { memberId, index: 2, done: true }),
      'team.automatic',
    );
    await admin.as.mutation(api.team.addChecklistItem, { memberId, label: 'Laptop issued', required: false });
    await admin.as.mutation(api.team.removeChecklistItem, { memberId, index: 4 });
    await expectCode(admin.as.mutation(api.team.removeChecklistItem, { memberId, index: 2 }), 'team.automatic');

    // The member accepts and sets up 2FA.
    const session = await createAuthSession(t, { email: 'dayo@unbuilt.studio', twoFactorEnabled: true });
    await t.run((ctx) => ctx.db.patch('teamMembers', memberId, { authUserId: session.authUserId, status: 'active' }));

    const items = (await admin.as.query(api.team.get, { memberId })).onboarding!.items;
    expect(items.map((item) => [item.label, item.done])).toEqual([
      ['NDA signed', true],
      ['Agreement signed', false],
      ['2FA enabled', true],
      ['Added to projects', false],
      ['Laptop issued', false],
    ]);
    const checklist = await t.run((ctx) => ctx.db.query('checklists').first());
    expect(checklist?.items[0]).toMatchObject({ doneBy: admin.memberId, doneAt: Date.now() });

    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    await expectCode(
      finance.as.mutation(api.team.setChecklistItem, { memberId, index: 1, done: true }),
      'auth.forbidden',
    );
  });
});

describe('avatars', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
  const store = () =>
    t.run((ctx) => ctx.storage.store(new Blob([PNG], { type: 'image/png' }))) as Promise<Id<'_storage'>>;

  it('lets members set their own photo and team.manage set anyone’s', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });

    const own = await member.as.mutation(api.team.setAvatar, {
      memberId: member.memberId,
      storageId: await store(),
      name: 'me.png',
      contentType: 'image/png',
    });
    expect(own).toMatchObject({ ok: true });
    await expectCode(
      member.as.mutation(api.team.setAvatar, {
        memberId: admin.memberId,
        storageId: await store(),
        name: 'x.png',
        contentType: 'image/png',
      }),
      'team.forbidden',
    );

    const replaced = await admin.as.mutation(api.team.setAvatar, {
      memberId: member.memberId,
      storageId: await store(),
      name: 'new.png',
      contentType: 'image/png',
    });
    expect(replaced).toMatchObject({ ok: true });
    expect(await t.run((ctx) => ctx.db.query('files').collect())).toHaveLength(1);

    // Any team member can fetch an avatar.
    vi.stubEnv('FILE_URL_SECRET', 'a-test-secret-that-is-at-least-32-chars');
    vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
    const fileId = (await t.run((ctx) => ctx.db.get('teamMembers', member.memberId)))!.avatarFileId!;
    expect(await member.as.query(api.files.teamDownloadUrl, { fileId })).toHaveProperty('url');
  });
});
