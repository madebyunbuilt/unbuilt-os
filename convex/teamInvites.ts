import { v } from 'convex/values';
import { internal } from './_generated/api';
import { sendAuthEmail } from './lib/authEmails';
import { internalAction, internalMutation, internalQuery } from './lib/functions';
import { teamAppOrigin } from './lib/hosts';

// Sends invitation emails after the inviting mutation commits, so a failed send never undoes the invitation.

export const inviteDetails = internalQuery({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    const member = await ctx.db.get('teamMembers', memberId);
    if (!member || member.status !== 'invited' || !member.inviteExpiresAt) return null;
    const role = await ctx.db.get('roles', member.roleId);
    const inviter = member.invitedByMemberId ? await ctx.db.get('teamMembers', member.invitedByMemberId) : null;
    return {
      email: member.email,
      roleName: role?.name ?? 'a team member',
      inviterName: inviter?.name ?? 'Unbuilt Studio',
      expiresAt: member.inviteExpiresAt,
    };
  },
});

export const markSent = internalMutation({
  args: { memberId: v.id('teamMembers'), sentAt: v.number() },
  handler: async (ctx, { memberId, sentAt }) => {
    if (await ctx.db.get('teamMembers', memberId)) {
      await ctx.db.patch('teamMembers', memberId, { inviteLastSentAt: sentAt });
    }
  },
});

export const send = internalAction({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    const invite = await ctx.runQuery(internal.teamInvites.inviteDetails, { memberId });
    if (!invite) return;

    const origin = teamAppOrigin();
    if (!origin) {
      console.error('Invitation not sent: set APP_URL or an exact host in AUTH_ALLOWED_HOSTS on this deployment');
      return;
    }
    const url = new URL('/sign-in', origin);
    url.searchParams.set('email', invite.email);

    await sendAuthEmail({
      kind: 'invitation',
      to: invite.email,
      url: url.toString(),
      inviterName: invite.inviterName,
      roleName: invite.roleName,
      expiresAt: invite.expiresAt,
    });
    await ctx.runMutation(internal.teamInvites.markSent, { memberId, sentAt: Date.now() });
  },
});
