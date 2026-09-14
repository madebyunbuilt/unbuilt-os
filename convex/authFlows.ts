import { v } from 'convex/values';
import { appendAuditEntry } from './lib/audit';
import { internalMutation, internalQuery } from './lib/functions';
import { normalizeEmail, principalForEmail } from './lib/principals';

// Internal functions the Better Auth hooks in auth.ts call during sign-in.

const principalKind = v.union(v.literal('team'), v.literal('client'), v.null());

export const principalKindForEmail = internalQuery({
  args: { email: v.string() },
  returns: principalKind,
  handler: async (ctx, { email }) => (await principalForEmail(ctx, email))?.kind ?? null,
});

/**
 * The principal kind for a Better Auth user. Better Auth links a new user to its invitation after the sign-in request
 * finishes, so on the first sign-in this falls back to the invitation for the same email.
 */
export const principalKindForUser = internalQuery({
  args: { authUserId: v.string(), email: v.string() },
  returns: principalKind,
  handler: async (ctx, { authUserId, email }) => {
    const member = await ctx.db
      .query('teamMembers')
      .withIndex('by_authUser', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (member) return 'team';
    const contact = await ctx.db
      .query('contacts')
      .withIndex('by_authUser', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (contact) return 'client';
    const invited = await principalForEmail(ctx, email);
    const alreadyLinked = invited?.kind === 'team' ? invited.member.authUserId : invited?.contact.authUserId;
    return invited && !alreadyLinked ? invited.kind : null;
  },
});

/** Links a new Better Auth user to the invited principal with the same email. An invited team member becomes active. */
export const linkAuthUser = internalMutation({
  args: { authUserId: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { authUserId, email }) => {
    const principal = await principalForEmail(ctx, normalizeEmail(email));
    if (!principal) throw new Error('No invitation matches this account');

    const actor = { actorKind: 'system' as const, authUserId };
    if (principal.kind === 'team') {
      const before = principal.member;
      await ctx.db.patch('teamMembers', before._id, {
        authUserId,
        ...(before.status === 'invited' ? { status: 'active' as const, acceptedAt: Date.now() } : {}),
      });
      const after = await ctx.db.get('teamMembers', before._id);
      await appendAuditEntry(ctx.db, actor, {
        action: 'update',
        table: 'teamMembers',
        recordId: before._id,
        before,
        after,
      });
    } else {
      const before = principal.contact;
      await ctx.db.patch('contacts', before._id, { authUserId });
      const after = await ctx.db.get('contacts', before._id);
      await appendAuditEntry(ctx.db, actor, {
        action: 'update',
        table: 'contacts',
        recordId: before._id,
        before,
        after,
      });
    }
    return null;
  },
});
