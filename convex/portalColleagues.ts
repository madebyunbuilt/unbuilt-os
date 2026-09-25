import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { crmError, recordActivity, text } from './lib/crm';
import { portalMutation, portalQuery } from './lib/functions';
import { type ClientPrincipal } from './lib/principals';
import { roleByKey } from './lib/team';
import { isEmail } from './lib/validation';

// A client admin managing their own people (12-client-portal.md, Team). They invite colleagues, set whether each is an
// admin or a member, and take access away again — all inside their own client, and never in a way that leaves the
// client with no admin at all.

type PortalRole = 'client_admin' | 'client_member';

async function colleagues(ctx: QueryCtx | MutationCtx, clientId: Id<'clients'>) {
  return await ctx.db
    .query('contacts')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
}

async function roleKeyOf(ctx: QueryCtx | MutationCtx, contact: Doc<'contacts'>) {
  if (!contact.portalRoleId) return null;
  return (await ctx.db.get('roles', contact.portalRoleId))?.key ?? null;
}

/**
 * Refuses a change that would leave the client with nobody who can act. Invoices and change requests are the admin's
 * to handle, so a client with no admin can do nothing but read, and cannot even put itself right.
 */
async function assertAnotherAdminRemains(
  ctx: QueryCtx | MutationCtx,
  clientId: Id<'clients'>,
  changing: Id<'contacts'>,
) {
  const rows = await colleagues(ctx, clientId);
  for (const contact of rows) {
    if (contact._id === changing || !contact.portalAccess || contact.status !== 'active') continue;
    if ((await roleKeyOf(ctx, contact)) === 'client_admin') return;
  }
  throw crmError(
    'crm.lastAdmin',
    'Somebody has to be able to approve and pay. Make a colleague an admin first, or ask Unbuilt.',
  );
}

export const list = portalQuery('portal.colleagues.manage')({
  args: {},
  handler: async (ctx) => {
    const principal = ctx.principal as ClientPrincipal;
    const rows = await colleagues(ctx, principal.clientId);
    return await Promise.all(
      rows
        .filter((contact) => contact.status === 'active')
        .map(async (contact) => ({
          id: contact._id,
          name: contact.name,
          email: contact.email,
          jobTitle: contact.jobTitle,
          hasAccess: contact.portalAccess,
          role: (await roleKeyOf(ctx, contact)) as PortalRole | null,
          invitedAt: contact.portalInvitedAt,
          // So the screen never offers somebody the means to lock themselves out.
          isYou: contact._id === principal.contact._id,
        })),
    );
  },
});

/**
 * Inviting a colleague. A contact the studio already holds is given access; anyone else is added first, so a client
 * admin never has to ask the studio to create a record before they can share the portal.
 */
export const invite = portalMutation('portal.colleagues.manage')({
  args: {
    name: v.string(),
    email: v.string(),
    jobTitle: v.optional(v.string()),
    role: v.union(v.literal('client_admin'), v.literal('client_member')),
  },
  handler: async (ctx, args) => {
    const principal = ctx.principal as ClientPrincipal;
    const email = args.email.trim().toLowerCase();
    if (!isEmail(email)) throw crmError('crm.invalid', 'That does not look like an email address');
    const name = text(args.name, 'Name', { required: true, max: 120 })!;

    // The same rule the studio's own path keeps: one portal sign-in per email, and never a team member's.
    const member = await ctx.db
      .query('teamMembers')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();
    if (member && member.status !== 'offboarded') {
      throw crmError('crm.emailInUse', `${email} belongs to Unbuilt, so it cannot be invited here`);
    }
    const existing = await ctx.db
      .query('contacts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .collect();
    if (existing.some((other) => other.portalAccess && other.status === 'active')) {
      throw crmError('crm.emailInUse', `${email} already has access`);
    }

    const role = await roleByKey(ctx, args.role);
    if (!role) throw crmError('crm.invalid', 'Client roles are missing; run the seed');

    const theirs = existing.find((other) => other.clientId === principal.clientId && other.status === 'active');
    const contactId =
      theirs?._id ??
      (await ctx.db.insert('contacts', {
        clientId: principal.clientId,
        name,
        email,
        jobTitle: text(args.jobTitle, 'Job title', { max: 120 }),
        isPrimary: false,
        isBilling: false,
        portalAccess: false,
        status: 'active',
      }));

    await ctx.db.patch('contacts', contactId, {
      portalAccess: true,
      portalRoleId: role._id,
      portalInvitedAt: Date.now(),
    });
    await recordActivity(ctx, {
      subject: { table: 'contacts', id: contactId },
      clientId: principal.clientId,
      type: 'system',
      title: `${name} invited to the portal as ${role.name} by ${principal.contact.name}`,
      actor: { kind: 'client', id: principal.contact._id },
      meta: { contactId },
    });
    // The email says who asked them, which for a colleague is the admin rather than the studio.
    await ctx.scheduler.runAfter(0, internal.portalInvites.send, {
      contactId,
      inviterContactId: principal.contact._id,
    });
    return { contactId };
  },
});

export const setRole = portalMutation('portal.colleagues.manage')({
  args: {
    contactId: v.id('contacts'),
    role: v.union(v.literal('client_admin'), v.literal('client_member')),
  },
  handler: async (ctx, { contactId, role: key }) => {
    const principal = ctx.principal as ClientPrincipal;
    const contact = await ctx.db.get('contacts', contactId);
    if (!contact || contact.clientId !== principal.clientId || contact.status !== 'active') {
      throw crmError('crm.notFound', 'That colleague is not here');
    }
    if (!contact.portalAccess) throw crmError('crm.invalid', 'They do not have access yet');
    if (key === 'client_member') await assertAnotherAdminRemains(ctx, principal.clientId, contactId);

    const role = await roleByKey(ctx, key);
    if (!role) throw crmError('crm.invalid', 'Client roles are missing; run the seed');
    await ctx.db.patch('contacts', contactId, { portalRoleId: role._id });
    await recordActivity(ctx, {
      subject: { table: 'contacts', id: contactId },
      clientId: principal.clientId,
      type: 'system',
      title: `${contact.name} is now ${role.name}, set by ${principal.contact.name}`,
      actor: { kind: 'client', id: principal.contact._id },
      meta: { contactId },
    });
  },
});

/** Taking access away. The contact stays: the studio still needs to know who they were dealing with. */
export const revoke = portalMutation('portal.colleagues.manage')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => {
    const principal = ctx.principal as ClientPrincipal;
    const contact = await ctx.db.get('contacts', contactId);
    if (!contact || contact.clientId !== principal.clientId) {
      throw crmError('crm.notFound', 'That colleague is not here');
    }
    if (contactId === principal.contact._id) {
      throw crmError('crm.notYourself', 'You cannot take away your own access; ask a colleague or Unbuilt');
    }
    await assertAnotherAdminRemains(ctx, principal.clientId, contactId);
    await ctx.db.patch('contacts', contactId, { portalAccess: false, portalRoleId: undefined });
    await recordActivity(ctx, {
      subject: { table: 'contacts', id: contactId },
      clientId: principal.clientId,
      type: 'system',
      title: `${contact.name}'s portal access removed by ${principal.contact.name}`,
      actor: { kind: 'client', id: principal.contact._id },
      meta: { contactId },
    });
  },
});
