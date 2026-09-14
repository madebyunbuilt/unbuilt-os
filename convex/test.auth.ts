import { convexTest } from 'convex-test';
import { components } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { DEFAULT_ROLES, type SystemRoleKey } from './lib/permissions';
import authSchema from './betterAuth/schema';
import schema from './schema';
import { authModules, modules } from './test.setup';

// Test helpers for anything that needs signed-in principals. Convex skips files with more than one dot when deploying.

export function newTest() {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', authSchema, authModules);
  return t;
}

export type TestConvex = ReturnType<typeof newTest>;

export async function seedRoles(t: TestConvex): Promise<Record<SystemRoleKey, Id<'roles'>>> {
  return await t.run(async (ctx) => {
    const ids = {} as Record<SystemRoleKey, Id<'roles'>>;
    for (const role of DEFAULT_ROLES) {
      ids[role.key] = await ctx.db.insert('roles', { ...role, permissions: [...role.permissions], isSystem: true });
    }
    return ids;
  });
}

/**
 * A Better Auth user with a live session, as the sign-in flow would leave them. `signedInAt` backdates the sign-in
 * with no activity since; the session itself stays freshly refreshed, as token renewals keep it.
 */
export async function createAuthSession(
  t: TestConvex,
  {
    email,
    twoFactorEnabled = true,
    signedInAt = Date.now(),
  }: { email: string; twoFactorEnabled?: boolean; signedInAt?: number },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'user',
        data: { name: email, email, emailVerified: true, twoFactorEnabled, createdAt: now, updatedAt: now },
      },
    });
    const session = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'session',
        data: {
          userId: user._id,
          token: `token-${user._id}`,
          expiresAt: now + 7 * 24 * 60 * 60 * 1000,
          createdAt: signedInAt,
          updatedAt: now,
          ipAddress: '203.0.113.7',
          userAgent: 'vitest',
        },
      },
    });
    return { authUserId: user._id as string, sessionId: session._id as string };
  });
}

export function asSession(t: TestConvex, session: { authUserId: string; sessionId: string }) {
  return t.withIdentity({ subject: session.authUserId, sessionId: session.sessionId });
}

export async function createTeamMember(
  t: TestConvex,
  roleId: Id<'roles'>,
  overrides: Partial<Doc<'teamMembers'>> & { email: string },
  session: { twoFactorEnabled?: boolean; signedInAt?: number } = {},
) {
  const auth = await createAuthSession(t, { email: overrides.email, ...session });
  const memberId = await t.run((ctx) =>
    ctx.db.insert('teamMembers', {
      name: overrides.email,
      employmentType: 'employee',
      status: 'active',
      timezone: 'Africa/Lagos',
      skills: [],
      roleId,
      authUserId: auth.authUserId,
      ...overrides,
    }),
  );
  return { memberId, ...auth, as: asSession(t, auth) };
}

export async function createClientUser(
  t: TestConvex,
  portalRoleId: Id<'roles'>,
  { clientName, email, portalEnabled = true }: { clientName: string; email: string; portalEnabled?: boolean },
) {
  const auth = await createAuthSession(t, { email });
  const { clientId, contactId } = await t.run(async (ctx) => {
    const clientId = await ctx.db.insert('clients', {
      displayName: clientName,
      kind: 'company',
      status: 'active',
      defaultCurrency: 'NGN',
      timezone: 'Africa/Lagos',
      portalEnabled,
    });
    const contactId = await ctx.db.insert('contacts', {
      clientId,
      name: email,
      email,
      isPrimary: true,
      isBilling: true,
      portalAccess: true,
      portalRoleId,
      authUserId: auth.authUserId,
      status: 'active',
    });
    return { clientId, contactId };
  });
  return { clientId, contactId, ...auth, as: asSession(t, auth) };
}
