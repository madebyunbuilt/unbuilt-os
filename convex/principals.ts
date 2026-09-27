import { v } from 'convex/values';
import { internalQuery } from './lib/functions';
import { isTeamPermission, type TeamPermission } from './lib/permissions';
import { authError, requireTeamPrincipal } from './lib/principals';

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
