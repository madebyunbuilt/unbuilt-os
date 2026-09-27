import { v } from 'convex/values';
import { internalQuery } from './lib/functions';
import { isPortalPermission, isTeamPermission, type PortalPermission, type TeamPermission } from './lib/permissions';
import { authError, type PortalActionPrincipal, requireClientPrincipal, requireTeamPrincipal } from './lib/principals';

/** teamAction resolves its caller here, because actions cannot read the database. */
export const teamPrincipalForAction = internalQuery({
  // An empty permission means "any team member", for an action whose own rules decide what the caller may reach.
  args: { permission: v.optional(v.string()) },
  handler: async (ctx, { permission }) => {
    if (permission !== undefined && !isTeamPermission(permission)) {
      throw authError('auth.forbidden', 'You do not have access to this');
    }
    const principal = await requireTeamPrincipal(ctx, permission ?? null);
    return {
      memberId: principal.member._id,
      memberName: principal.member.name,
      authUserId: principal.session.authUserId,
      // The vault's window for a second factor is per session, and its access log records where from.
      sessionId: principal.session.sessionId,
      // Signing in as a team member required a second factor, so the session's own start counts as one.
      signedInAt: principal.session.signedInAt,
      ip: principal.session.ip,
      roleKey: principal.role.key,
      permissions: [...principal.permissions] as TeamPermission[],
    };
  },
});

/** portalAction resolves its caller here. The client is taken from the session, never from an argument. */
export const clientPrincipalForAction = internalQuery({
  args: { permission: v.optional(v.string()) },
  handler: async (ctx, { permission }): Promise<PortalActionPrincipal> => {
    if (permission !== undefined && !isPortalPermission(permission)) {
      throw authError('auth.forbidden', 'You do not have access to this');
    }
    const principal = await requireClientPrincipal(ctx, permission ?? null);
    return {
      contactId: principal.contact._id,
      contactName: principal.contact.name,
      clientId: principal.clientId,
      authUserId: principal.session.authUserId,
      sessionId: principal.session.sessionId,
      ip: principal.session.ip,
      roleKey: principal.role.key,
      permissions: [...principal.permissions] as PortalPermission[],
    };
  },
});
