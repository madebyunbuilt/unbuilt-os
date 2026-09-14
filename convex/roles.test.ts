import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './_generated/api';
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

beforeEach(async () => {
  t = newTest();
  roles = await seedRoles(t);
});

const customTeamRole = {
  kind: 'team' as const,
  name: 'Designer',
  description: 'Design work',
  permissions: ['projects.view.assigned'],
};

describe('roles.list', () => {
  it('requires roles.manage', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });

    expect(await admin.as.query(api.roles.list, { kind: 'client' })).toHaveLength(2);
    await expectCode(pm.as.query(api.roles.list, {}), 'auth.forbidden');
    await expectCode(client.as.query(api.roles.list, {}), 'auth.forbidden');
    await expectCode(t.query(api.roles.list, {}), 'auth.unauthenticated');
  });
});

describe('roles.save', () => {
  it('lets roles.manage create and edit custom roles, with an audit entry for each write', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const roleId = await admin.as.mutation(api.roles.save, customTeamRole);
    await admin.as.mutation(api.roles.save, {
      ...customTeamRole,
      roleId,
      permissions: ['projects.view.assigned', 'time.log.own'],
    });

    const saved = await t.run((ctx) => ctx.db.get('roles', roleId));
    expect(saved).toMatchObject({
      key: 'custom_designer',
      isSystem: false,
      permissions: ['projects.view.assigned', 'time.log.own'],
    });
    const audit = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(audit.map((entry) => [entry.action, entry.permission])).toEqual([
      ['insert', 'roles.manage'],
      ['update', 'roles.manage'],
    ]);
  });

  it('gives each custom role a unique key', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const first = await admin.as.mutation(api.roles.save, customTeamRole);
    const second = await admin.as.mutation(api.roles.save, customTeamRole);
    const keys = await t.run(async (ctx) => [
      (await ctx.db.get('roles', first))?.key,
      (await ctx.db.get('roles', second))?.key,
    ]);
    expect(keys).toEqual(['custom_designer', 'custom_designer_2']);
  });

  it('rejects a team role with a portal key and a client role with a team key', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    await expectCode(
      admin.as.mutation(api.roles.save, {
        ...customTeamRole,
        permissions: ['projects.view.assigned', 'portal.invoices.pay'],
      }),
      'roles.invalidPermissions',
    );
    await expectCode(
      admin.as.mutation(api.roles.save, {
        kind: 'client',
        name: 'Viewer',
        description: '',
        permissions: ['invoices.view'],
      }),
      'roles.invalidPermissions',
    );
    expect(await t.run((ctx) => ctx.db.query('auditLog').collect())).toEqual([]);
  });

  it('never grants team permissions the caller does not hold', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const owner = await createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio' });
    const escalation = { ...customTeamRole, permissions: ['roles.manage', 'owner.transfer'] };

    await expectCode(admin.as.mutation(api.roles.save, escalation), 'roles.cannotGrant');
    const roleId = await admin.as.mutation(api.roles.save, customTeamRole);
    await expectCode(admin.as.mutation(api.roles.save, { ...escalation, roleId }), 'roles.cannotGrant');
    expect(await owner.as.mutation(api.roles.save, escalation)).toBeTruthy();
  });

  it('lets only the Owner edit system roles', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const owner = await createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio' });
    const edit = {
      roleId: roles.member,
      kind: 'team' as const,
      name: 'Member',
      description: 'Edited',
      permissions: ['time.log.own'],
    };

    await expectCode(admin.as.mutation(api.roles.save, edit), 'roles.systemRole');
    await owner.as.mutation(api.roles.save, edit);
    expect(await t.run((ctx) => ctx.db.get('roles', roles.member))).toMatchObject({
      description: 'Edited',
      isSystem: true,
    });
  });

  it('does not let a role change kind', async () => {
    const owner = await createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio' });
    await expectCode(
      owner.as.mutation(api.roles.save, {
        roleId: roles.member,
        kind: 'client',
        name: 'Member',
        description: '',
        permissions: [],
      }),
      'roles.invalid',
    );
  });

  it('rejects callers without roles.manage', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(finance.as.mutation(api.roles.save, customTeamRole), 'auth.forbidden');
    await expectCode(client.as.mutation(api.roles.save, customTeamRole), 'auth.forbidden');
  });
});

describe('roles.remove', () => {
  it('never deletes a system role, even for the Owner', async () => {
    const owner = await createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio' });
    await expectCode(owner.as.mutation(api.roles.remove, { roleId: roles.content_editor }), 'roles.systemRole');
  });

  it('refuses to delete a role someone still holds', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const roleId = await admin.as.mutation(api.roles.save, customTeamRole);
    await createTeamMember(t, roleId, { email: 'designer@unbuilt.studio' });
    await expectCode(admin.as.mutation(api.roles.remove, { roleId }), 'roles.inUse');

    const clientRoleId = await admin.as.mutation(api.roles.save, {
      kind: 'client',
      name: 'Viewer',
      description: '',
      permissions: ['portal.projects.view'],
    });
    await createClientUser(t, clientRoleId, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(admin.as.mutation(api.roles.remove, { roleId: clientRoleId }), 'roles.inUse');
  });

  it('deletes an unused custom role', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const roleId = await admin.as.mutation(api.roles.save, customTeamRole);
    await admin.as.mutation(api.roles.remove, { roleId });
    expect(await t.run((ctx) => ctx.db.get('roles', roleId))).toBeNull();
  });

  it('rejects callers without roles.manage', async () => {
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });
    await expectCode(member.as.mutation(api.roles.remove, { roleId: roles.member }), 'auth.forbidden');
  });
});
