import { customAction, customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import { internal } from '../_generated/api';
import { type Id } from '../_generated/dataModel';
import {
  action,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
  internalQuery as rawInternalQuery,
  mutation,
  query,
} from '../_generated/server';
import { auditedDatabase, type AuditActor } from './audit';
import { type PortalPermission, type TeamPermission } from './permissions';
import {
  authError,
  type ClientPrincipal,
  getAuthSession,
  requireClientPrincipal,
  requireTeamPrincipal,
  type TeamPrincipal,
} from './principals';

// The only function builders modules may use (03-auth-and-permissions.md, Enforcement). A repo test fails the build if
// any other file imports a raw builder.
//
//   export const list = teamQuery('clients.view')({ args: {}, handler: async (ctx) => ... });

function teamActor(principal: TeamPrincipal, permission: string): AuditActor {
  return {
    actorKind: 'team',
    actorId: principal.member._id,
    authUserId: principal.session.authUserId,
    permission,
    ip: principal.session.ip,
    userAgent: principal.session.userAgent,
  };
}

function clientActor(principal: ClientPrincipal, permission: string): AuditActor {
  return {
    actorKind: 'client',
    actorId: principal.contact._id,
    authUserId: principal.session.authUserId,
    permission,
    ip: principal.session.ip,
    userAgent: principal.session.userAgent,
  };
}

function teamContext(principal: TeamPrincipal) {
  return {
    principal,
    permissions: principal.permissions,
    can: (permission: TeamPermission) => principal.permissions.has(permission),
  };
}

/** Portal reads are filtered to the caller's client. The client id always comes from here, never from arguments. */
function clientContext(principal: ClientPrincipal) {
  const clientId = principal.clientId;
  return {
    principal,
    permissions: principal.permissions,
    clientId,
    can: (permission: PortalPermission) => principal.permissions.has(permission),
    /** The document only when it belongs to the caller's client; otherwise the caller sees not found. */
    ownedByClient: <T extends { clientId: Id<'clients'> }>(doc: T | null): T | null =>
      doc && doc.clientId === clientId ? doc : null,
  };
}

export const teamQuery = (permission: TeamPermission) =>
  customQuery(
    query,
    customCtx(async (ctx) => teamContext(await requireTeamPrincipal(ctx, permission))),
  );

export const teamMutation = (permission: TeamPermission) =>
  customMutation(
    mutation,
    customCtx(async (ctx) => {
      const principal = await requireTeamPrincipal(ctx, permission);
      return { ...teamContext(principal), db: auditedDatabase(ctx.db, teamActor(principal, permission)) };
    }),
  );

export const portalQuery = (permission: PortalPermission) =>
  customQuery(
    query,
    customCtx(async (ctx) => clientContext(await requireClientPrincipal(ctx, permission))),
  );

export const portalMutation = (permission: PortalPermission) =>
  customMutation(
    mutation,
    customCtx(async (ctx) => {
      const principal = await requireClientPrincipal(ctx, permission);
      return { ...clientContext(principal), db: auditedDatabase(ctx.db, clientActor(principal, permission)) };
    }),
  );

/** Actions have no database; they read and write through internal functions. */
export const teamAction = (permission: TeamPermission) =>
  customAction(
    action,
    customCtx(async (ctx) => {
      const principal = await ctx.runQuery(internal.principals.teamPrincipalForAction, { permission });
      return {
        principal,
        permissions: new Set(principal.permissions),
        can: (key: TeamPermission) => principal.permissions.includes(key),
      };
    }),
  );

/**
 * Any signed-in session, with or without a principal or 2FA. Only for what a session needs before it can use the app:
 * reading its own sign-in state. Never return business data from these.
 */
export const sessionQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const session = await getAuthSession(ctx);
    if (!session) throw authError('auth.unauthenticated', 'Sign in to continue');
    return { session };
  }),
);

/** Scheduler, crons and other functions. Not callable from clients. */
export const internalQuery = rawInternalQuery;
export const internalMutation = rawInternalMutation;
export const internalAction = rawInternalAction;
