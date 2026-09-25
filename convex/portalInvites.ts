import { v } from 'convex/values';
import { internal } from './_generated/api';
import { sendAuthEmail } from './lib/authEmails';
import { internalAction, internalMutation, internalQuery } from './lib/functions';
import { portalAppOrigin } from './lib/hosts';

// Sends client portal invitations after the granting mutation commits, so a failed send never undoes the access.

export const inviteDetails = internalQuery({
  args: {
    contactId: v.id('contacts'),
    // Whoever did the inviting: a team member, or a client admin inviting their own colleague.
    inviterMemberId: v.optional(v.id('teamMembers')),
    inviterContactId: v.optional(v.id('contacts')),
  },
  handler: async (ctx, { contactId, inviterMemberId, inviterContactId }) => {
    const contact = await ctx.db.get('contacts', contactId);
    if (!contact || !contact.portalAccess || contact.status !== 'active') return null;
    const client = await ctx.db.get('clients', contact.clientId);
    if (!client) return null;
    const inviter = inviterMemberId
      ? await ctx.db.get('teamMembers', inviterMemberId)
      : inviterContactId
        ? await ctx.db.get('contacts', inviterContactId)
        : null;
    return { email: contact.email, clientName: client.displayName, inviterName: inviter?.name ?? 'Unbuilt Studio' };
  },
});

export const markSent = internalMutation({
  args: { contactId: v.id('contacts'), sentAt: v.number() },
  handler: async (ctx, { contactId, sentAt }) => {
    if (await ctx.db.get('contacts', contactId)) {
      await ctx.db.patch('contacts', contactId, { portalInviteLastSentAt: sentAt });
    }
  },
});

export const send = internalAction({
  args: {
    contactId: v.id('contacts'),
    inviterMemberId: v.optional(v.id('teamMembers')),
    inviterContactId: v.optional(v.id('contacts')),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.runQuery(internal.portalInvites.inviteDetails, args);
    if (!invite) return;

    const origin = portalAppOrigin();
    if (!origin) {
      console.error('Portal invitation not sent: set PORTAL_URL or an exact portal host in AUTH_ALLOWED_HOSTS');
      return;
    }
    const url = new URL('/sign-in', origin);
    url.searchParams.set('email', invite.email);

    await sendAuthEmail({
      kind: 'portalInvitation',
      to: invite.email,
      url: url.toString(),
      inviterName: invite.inviterName,
      clientName: invite.clientName,
    });
    await ctx.runMutation(internal.portalInvites.markSent, { contactId: args.contactId, sentAt: Date.now() });
  },
});
