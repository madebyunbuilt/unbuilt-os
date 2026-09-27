import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type Permission, type PortalPermission, type TeamPermission } from './permissions';

// Identities: docs/spec/03-auth-and-permissions.md. Every signed-in person has exactly one principal: a team member or a
// client user. Both surfaces use one Better Auth instance, so the principal decides what a session may call.

export const TEAM_SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const PORTAL_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type AuthErrorCode =
  'auth.unauthenticated' | 'auth.sessionExpired' | 'auth.twoFactorRequired' | 'auth.forbidden' | 'auth.notFound';

export function authError(code: AuthErrorCode, message: string): ConvexError<{ code: AuthErrorCode; message: string }> {
  return new ConvexError({ code, message });
}

export type AuthSession = {
  authUserId: string;
  sessionId: string;
  email: string;
  twoFactorEnabled: boolean;
  /** Last real use of the app in this session (see lastActiveAt). */
  lastActiveAt: number;
  /** When the session began: for a team member, when they passed their two-factor check. */
  signedInAt: number;
  ip?: string;
  userAgent?: string;
};

export type TeamPrincipal = {
  kind: 'team';
  member: Doc<'teamMembers'>;
  role: Doc<'roles'>;
  permissions: ReadonlySet<TeamPermission>;
  session: AuthSession;
};

/**
 * What an action knows about its caller. Written out rather than inferred from the query that returns it: inferring
 * it closes a circle through the generated api types, and every api.* result in the codebase collapses to a loose
 * type (see teamAction in lib/functions.ts).
 */
export type ActionPrincipal = {
  memberId: Id<'teamMembers'>;
  memberName: string;
  authUserId: string;
  sessionId: string;
  signedInAt: number;
  ip?: string;
  roleKey: string;
  permissions: TeamPermission[];
};

export type ClientPrincipal = {
  kind: 'client';
  contact: Doc<'contacts'>;
  clientId: Id<'clients'>;
  role: Doc<'roles'>;
  permissions: ReadonlySet<PortalPermission>;
  session: AuthSession;
};

export type Principal = TeamPrincipal | ClientPrincipal;

type Ctx = QueryCtx | MutationCtx;

/**
 * When the person last used the app in this session: the latest recorded activity, or signing in. Better Auth's own
 * `updatedAt` is not used, because token renewals refresh it while a tab sits open untouched.
 */
export async function lastActiveAt(ctx: Ctx, session: { _id: string; createdAt: number }): Promise<number> {
  const activity = await ctx.db
    .query('sessionActivity')
    .withIndex('by_session', (q) => q.eq('sessionId', session._id))
    .unique();
  return Math.max(activity?.lastActiveAt ?? 0, session.createdAt);
}

/** The current Better Auth session, or null when signed out, expired or revoked. */
export async function getAuthSession(ctx: Ctx): Promise<AuthSession | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity.sessionId !== 'string') return null;

  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'session',
    where: [
      { field: '_id', value: identity.sessionId },
      { field: 'expiresAt', operator: 'gt', value: Date.now() },
    ],
  });
  if (!session || session.userId !== identity.subject) return null;

  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: '_id', value: identity.subject }],
  });
  if (!user) return null;

  return {
    authUserId: user._id,
    sessionId: session._id,
    email: user.email,
    twoFactorEnabled: user.twoFactorEnabled === true,
    lastActiveAt: await lastActiveAt(ctx, session),
    // When this session began: for a team member, the moment they passed their two-factor check.
    signedInAt: session.createdAt,
    ip: session.ipAddress ?? undefined,
    userAgent: session.userAgent ?? undefined,
  };
}

async function requireSession(ctx: Ctx): Promise<AuthSession> {
  const session = await getAuthSession(ctx);
  if (!session) throw authError('auth.unauthenticated', 'Sign in to continue');
  return session;
}

function forbidden(): never {
  // One message for every refusal, so a caller cannot tell a missing permission from a missing principal.
  throw authError('auth.forbidden', 'You do not have access to this');
}

/** Session valid, active team member, 2FA on, not idle for 12 hours, and (when given) the role holds `permission`. */
export async function requireTeamPrincipal(ctx: Ctx, permission: TeamPermission | null): Promise<TeamPrincipal> {
  const session = await requireSession(ctx);
  const member = await ctx.db
    .query('teamMembers')
    .withIndex('by_authUser', (q) => q.eq('authUserId', session.authUserId))
    .unique();
  if (!member || member.status !== 'active') forbidden();
  if (!session.twoFactorEnabled) throw authError('auth.twoFactorRequired', 'Set up two-factor authentication first');
  if (Date.now() - session.lastActiveAt > TEAM_SESSION_IDLE_MS) {
    throw authError('auth.sessionExpired', 'Your session expired after 12 hours of inactivity');
  }

  const role = await ctx.db.get('roles', member.roleId);
  if (!role || role.kind !== 'team') forbidden();
  const permissions = new Set(role.permissions as TeamPermission[]);
  if (permission && !permissions.has(permission)) forbidden();

  return { kind: 'team', member, role, permissions, session };
}

/** Session valid, active contact with portal access on a portal-enabled client, and the role holds `permission`. */
export async function requireClientPrincipal(ctx: Ctx, permission: PortalPermission | null): Promise<ClientPrincipal> {
  const session = await requireSession(ctx);
  const contact = await ctx.db
    .query('contacts')
    .withIndex('by_authUser', (q) => q.eq('authUserId', session.authUserId))
    .unique();
  if (!contact || contact.status !== 'active' || !contact.portalAccess || !contact.portalRoleId) forbidden();

  const client = await ctx.db.get('clients', contact.clientId);
  if (!client || !client.portalEnabled) forbidden();

  const role = await ctx.db.get('roles', contact.portalRoleId);
  if (!role || role.kind !== 'client') forbidden();
  const permissions = new Set(role.permissions as PortalPermission[]);
  if (permission && !permissions.has(permission)) forbidden();

  return { kind: 'client', contact, clientId: contact.clientId, role, permissions, session };
}

/** Which kind of principal an email address belongs to. Used before sending sign-in links and on first sign-in. */
export async function principalForEmail(
  ctx: Ctx,
  email: string,
): Promise<{ kind: 'team'; member: Doc<'teamMembers'> } | { kind: 'client'; contact: Doc<'contacts'> } | null> {
  const normalized = normalizeEmail(email);
  const members = await ctx.db
    .query('teamMembers')
    .withIndex('by_email', (q) => q.eq('email', normalized))
    .collect();
  const contacts = (
    await ctx.db
      .query('contacts')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .collect()
  ).filter((contact) => contact.portalAccess && contact.status === 'active');
  const now = Date.now();
  // An invite that has expired no longer lets anyone create an account; resending renews it.
  const eligibleMembers = members.filter(
    (member) =>
      member.status === 'active' ||
      (member.status === 'invited' && (member.inviteExpiresAt === undefined || member.inviteExpiresAt > now)),
  );

  // One person, one principal. An address on both sides, or on two clients, signs in to neither.
  if (eligibleMembers.length + contacts.length !== 1) return null;
  return eligibleMembers.length === 1
    ? { kind: 'team', member: eligibleMembers[0] }
    : { kind: 'client', contact: contacts[0] };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deletes every Better Auth session for a user, so offboarding takes effect on the next request. */
export async function revokeAllSessions(ctx: MutationCtx, authUserId: string): Promise<void> {
  let cursor: string | null = null;
  do {
    const result: { continueCursor: string; isDone: boolean } = await ctx.runMutation(
      components.betterAuth.adapter.deleteMany,
      {
        input: { model: 'session', where: [{ field: 'userId', value: authUserId }] },
        paginationOpts: { cursor, numItems: 100 },
      },
    );
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
}

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return (principal.permissions as ReadonlySet<Permission>).has(permission);
}
