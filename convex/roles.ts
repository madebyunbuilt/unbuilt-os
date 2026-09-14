import { ConvexError, v } from 'convex/values';
import { teamMutation, teamQuery } from './lib/functions';
import { assertValidRolePermissions, OWNER_ROLE_KEY, type TeamPermission } from './lib/permissions';

// Roles and permissions (03-auth-and-permissions.md, Default roles). System roles are seeded, cannot be deleted, and only
// the Owner can edit them. `roles.manage` creates and edits custom roles.

const roleKind = v.union(v.literal('team'), v.literal('client'));

export const list = teamQuery('roles.manage')({
  args: { kind: v.optional(roleKind) },
  handler: async (ctx, { kind }) => {
    const roles = kind
      ? await ctx.db
          .query('roles')
          .withIndex('by_kind', (q) => q.eq('kind', kind))
          .collect()
      : await ctx.db.query('roles').collect();
    return roles.sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name));
  },
});

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'role'
  );
}

export const save = teamMutation('roles.manage')({
  args: {
    roleId: v.optional(v.id('roles')),
    kind: roleKind,
    name: v.string(),
    description: v.string(),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, { roleId, kind, name, description, permissions }) => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new ConvexError({ code: 'roles.invalid', message: 'A role needs a name' });
    assertValidRolePermissions(kind, permissions);
    // No one grants team permissions they do not hold, so roles.manage cannot be used to climb to Owner.
    const notHeld = kind === 'team' ? permissions.filter((key) => !ctx.can(key as TeamPermission)) : [];
    if (notHeld.length > 0) {
      throw new ConvexError({
        code: 'roles.cannotGrant',
        message: `You cannot grant permissions you do not hold: ${notHeld.join(', ')}`,
      });
    }

    if (roleId) {
      const role = await ctx.db.get('roles', roleId);
      if (!role) throw new ConvexError({ code: 'roles.notFound', message: 'Role not found' });
      if (role.kind !== kind) throw new ConvexError({ code: 'roles.invalid', message: 'A role cannot change kind' });
      if (role.isSystem && !(ctx.principal.role.isSystem && ctx.principal.role.key === OWNER_ROLE_KEY)) {
        throw new ConvexError({ code: 'roles.systemRole', message: 'Only the Owner can edit system roles' });
      }
      await ctx.db.patch('roles', roleId, { name: trimmedName, description, permissions });
      return roleId;
    }

    const base = `custom_${slug(trimmedName)}`;
    let key = base;
    for (
      let n = 2;
      await ctx.db
        .query('roles')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique();
      n++
    ) {
      key = `${base}_${n}`;
    }
    return await ctx.db.insert('roles', { key, kind, name: trimmedName, description, permissions, isSystem: false });
  },
});

export const remove = teamMutation('roles.manage')({
  args: { roleId: v.id('roles') },
  handler: async (ctx, { roleId }) => {
    const role = await ctx.db.get('roles', roleId);
    if (!role) throw new ConvexError({ code: 'roles.notFound', message: 'Role not found' });
    if (role.isSystem) throw new ConvexError({ code: 'roles.systemRole', message: 'System roles cannot be deleted' });

    const member = await ctx.db
      .query('teamMembers')
      .withIndex('by_role', (q) => q.eq('roleId', roleId))
      .first();
    const contact = await ctx.db
      .query('contacts')
      .withIndex('by_portalRole', (q) => q.eq('portalRoleId', roleId))
      .first();
    if (member || contact) {
      throw new ConvexError({ code: 'roles.inUse', message: 'Move everyone off this role before deleting it' });
    }
    await ctx.db.delete('roles', roleId);
  },
});
