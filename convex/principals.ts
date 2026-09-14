import { v } from 'convex/values';
import { internalQuery } from './lib/functions';
import { isTeamPermission, type TeamPermission } from './lib/permissions';
import { authError, requireTeamPrincipal } from './lib/principals';

/** teamAction resolves its caller here, because actions cannot read the database. */
export const teamPrincipalForAction = internalQuery({
  args: { permission: v.string() },
  handler: async (ctx, { permission }) => {
    if (!isTeamPermission(permission)) throw authError('auth.forbidden', 'You do not have access to this');
    const principal = await requireTeamPrincipal(ctx, permission);
    return {
      memberId: principal.member._id,
      authUserId: principal.session.authUserId,
      roleKey: principal.role.key,
      permissions: [...principal.permissions] as TeamPermission[],
    };
  },
});
