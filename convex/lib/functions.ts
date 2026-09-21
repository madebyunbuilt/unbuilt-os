import { customAction, customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import { internal } from '../_generated/api';
import { type Id } from '../_generated/dataModel';
import {
  action,
  type ActionCtx,
  httpAction,
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
//
// Pass `null` as the permission only for a caller's own records that every principal of the surface has, such as their
// notifications; every other check (session, principal, 2FA, idle time, client scope) still applies.

function teamActor(principal: TeamPrincipal, permission: string | null): AuditActor {
  return {
    actorKind: 'team',
    actorId: principal.member._id,
    authUserId: principal.session.authUserId,
    permission: permission ?? undefined,
    ip: principal.session.ip,
    userAgent: principal.session.userAgent,
  };
}

function clientActor(principal: ClientPrincipal, permission: string | null): AuditActor {
  return {
    actorKind: 'client',
    actorId: principal.contact._id,
    authUserId: principal.session.authUserId,
    permission: permission ?? undefined,
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

export const teamQuery = (permission: TeamPermission | null) =>
  customQuery(
    query,
    customCtx(async (ctx) => teamContext(await requireTeamPrincipal(ctx, permission))),
  );

export const teamMutation = (permission: TeamPermission | null) =>
  customMutation(
    mutation,
    customCtx(async (ctx) => {
      const principal = await requireTeamPrincipal(ctx, permission);
      return { ...teamContext(principal), db: auditedDatabase(ctx.db, teamActor(principal, permission)) };
    }),
  );

export const portalQuery = (permission: PortalPermission | null) =>
  customQuery(
    query,
    customCtx(async (ctx) => clientContext(await requireClientPrincipal(ctx, permission))),
  );

export const portalMutation = (permission: PortalPermission | null) =>
  customMutation(
    mutation,
    customCtx(async (ctx) => {
      const principal = await requireClientPrincipal(ctx, permission);
      return { ...clientContext(principal), db: auditedDatabase(ctx.db, clientActor(principal, permission)) };
    }),
  );

/**
 * Actions have no database; they read and write through internal functions.
 *
 * Nothing uses this yet, and there is a catch when something does: an action's inferred types run back through
 * convex/_generated/api.d.ts, which includes the action's own module, and TypeScript gives up on the circle by quietly
 * widening every api.* result to a loose type. A public action needs explicit return types on itself and on every
 * function it calls. Where the work is heavy anyway, a teamMutation that checks the permission and schedules an
 * internalAction avoids the circle altogether: convex/documents.ts `send` does that.
 */
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

/**
 * Public HTTP endpoints: webhooks, the website's enquiry form, signed download links. The handler verifies its own
 * signature, token or Turnstile response before doing anything. This wrapper adds safe response headers and turns
 * unexpected errors into a bare 500, logging only the error's name. Rate limiting joins with the first public form.
 */
export const publicHttp = (handler: (ctx: ActionCtx, request: Request) => Promise<Response>) =>
  httpAction(async (ctx, request) => {
    let response: Response;
    try {
      response = await handler(ctx, request);
    } catch (error) {
      console.error('Public HTTP handler failed', error instanceof Error ? error.name : typeof error);
      response = new Response('Something went wrong', { status: 500 });
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  });

/** Scheduler, crons and other functions. Not callable from clients. */
export const internalQuery = rawInternalQuery;
export const internalMutation = rawInternalMutation;
export const internalAction = rawInternalAction;
