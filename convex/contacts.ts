import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { crmError, email as cleanEmail, getClient, getContact, phone, recordActivity, text } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { revokeAllSessions, type TeamPrincipal } from './lib/principals';
import { roleByKey } from './lib/team';

// Contacts (05-crm.md, Contacts). A contact's portal access lets them sign in to the client portal with their email;
// marking them as left, or revoking access, signs them out at once.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };

const SEARCH_LIMIT = 20;
const optInMethod = v.union(v.literal('portal_checkbox'), v.literal('written_consent'), v.literal('form'));

async function contactView(ctx: Ctx, contact: Doc<'contacts'>) {
  const role = contact.portalRoleId ? await ctx.db.get('roles', contact.portalRoleId) : null;
  return {
    id: contact._id,
    clientId: contact.clientId,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    whatsapp: contact.whatsapp,
    whatsappOptIn: contact.whatsappOptIn
      ? { at: contact.whatsappOptIn.at, method: contact.whatsappOptIn.method }
      : null,
    jobTitle: contact.jobTitle,
    isPrimary: contact.isPrimary,
    isBilling: contact.isBilling,
    portalAccess: contact.portalAccess,
    portalRole: role ? { id: role._id, key: role.key, name: role.name } : null,
    portalInvitedAt: contact.portalInvitedAt,
    portalInviteLastSentAt: contact.portalInviteLastSentAt,
    hasSignedIn: contact.authUserId !== undefined,
    status: contact.status,
    leftAt: contact.leftAt,
  };
}

async function clientContacts(ctx: Ctx, clientId: Id<'clients'>) {
  return await ctx.db
    .query('contacts')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
}

async function assertNoDuplicateOnClient(
  ctx: Ctx,
  clientId: Id<'clients'>,
  address: string,
  exceptId?: Id<'contacts'>,
) {
  const sameEmail = await ctx.db
    .query('contacts')
    .withIndex('by_email', (q) => q.eq('email', address))
    .collect();
  if (sameEmail.some((c) => c._id !== exceptId && c.clientId === clientId && c.status === 'active')) {
    throw crmError('crm.duplicate', `${address} is already a contact for this client`);
  }
}

/** A portal account belongs to one person: not a team member, and not a portal user at another client. */
async function assertEmailFreeForPortal(ctx: Ctx, contact: Doc<'contacts'>) {
  const member = await ctx.db
    .query('teamMembers')
    .withIndex('by_email', (q) => q.eq('email', contact.email))
    .first();
  if (member && member.status !== 'offboarded') {
    throw crmError('crm.emailInUse', `${contact.email} belongs to a team member, so it cannot sign in to the portal`);
  }
  const others = await ctx.db
    .query('contacts')
    .withIndex('by_email', (q) => q.eq('email', contact.email))
    .collect();
  if (others.some((other) => other._id !== contact._id && other.portalAccess && other.status === 'active')) {
    throw crmError('crm.emailInUse', `${contact.email} already has portal access for another client`);
  }
}

async function clientRole(ctx: Ctx, roleId: Id<'roles'>) {
  const role = await ctx.db.get('roles', roleId);
  if (!role || role.kind !== 'client') throw crmError('crm.invalid', 'Choose a client role');
  return role;
}

async function activity(
  ctx: MutationCtx & Principal,
  contact: Pick<Doc<'contacts'>, '_id' | 'clientId'>,
  title: string,
  body?: string,
) {
  await recordActivity(ctx, {
    subject: { table: 'contacts', id: contact._id },
    clientId: contact.clientId,
    type: 'system',
    title,
    body,
    actor: { kind: 'team', id: ctx.principal.member._id },
  });
}

export const listForClient = teamQuery('clients.view')({
  args: { clientId: v.id('clients'), includeLeft: v.optional(v.boolean()) },
  handler: async (ctx, { clientId, includeLeft }) => {
    await getClient(ctx, clientId);
    const contacts = (await clientContacts(ctx, clientId)).filter((c) => includeLeft || c.status === 'active');
    const views = await Promise.all(contacts.map((contact) => contactView(ctx, contact)));
    return views.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
  },
});

/** Client roles a contact's portal access can use. */
export const portalRoles = teamQuery('clients.view')({
  args: {},
  handler: async (ctx) => {
    const roles = await ctx.db
      .query('roles')
      .withIndex('by_kind', (q) => q.eq('kind', 'client'))
      .collect();
    return roles
      .map((role) => ({ id: role._id, key: role.key, name: role.name, description: role.description }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Finds contacts by name or email across clients, for pickers and duplicate checks. */
export const search = teamQuery('clients.view')({
  args: { query: v.string() },
  handler: async (ctx, { query }) => {
    const term = query.trim();
    if (term.length < 2) return [];
    const [byName, byEmail] = await Promise.all([
      ctx.db
        .query('contacts')
        .withSearchIndex('search_name', (q) => q.search('name', term))
        .take(SEARCH_LIMIT),
      ctx.db
        .query('contacts')
        .withSearchIndex('search_email', (q) => q.search('email', term.toLowerCase()))
        .take(SEARCH_LIMIT),
    ]);
    const contacts = [...new Map([...byEmail, ...byName].map((c) => [c._id, c])).values()].slice(0, SEARCH_LIMIT);
    return await Promise.all(
      contacts.map(async (contact) => ({
        id: contact._id,
        name: contact.name,
        email: contact.email,
        status: contact.status,
        clientId: contact.clientId,
        clientName: (await ctx.db.get('clients', contact.clientId))?.displayName ?? 'Unknown client',
      })),
    );
  },
});

const details = {
  name: v.string(),
  email: v.string(),
  phone: v.optional(v.string()),
  whatsapp: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  isBilling: v.boolean(),
};

function checkedDetails(args: { name: string; email: string; phone?: string; whatsapp?: string; jobTitle?: string }) {
  return {
    name: text(args.name, 'Name', { required: true, max: 120 })!,
    email: cleanEmail(args.email),
    phone: phone(args.phone, 'Phone'),
    whatsapp: phone(args.whatsapp, 'WhatsApp'),
    jobTitle: text(args.jobTitle, 'Job title', { max: 120 }),
  };
}

/** Adds a contact. The client's first active contact becomes the primary contact. */
export const create = teamMutation('contacts.manage')({
  args: { clientId: v.id('clients'), ...details },
  handler: async (ctx, { clientId, isBilling, ...args }) => {
    await getClient(ctx, clientId);
    const fields = checkedDetails(args);
    await assertNoDuplicateOnClient(ctx, clientId, fields.email);
    const hasPrimary = (await clientContacts(ctx, clientId)).some((c) => c.isPrimary && c.status === 'active');
    const contactId = await ctx.db.insert('contacts', {
      clientId,
      ...fields,
      isPrimary: !hasPrimary,
      isBilling,
      portalAccess: false,
      status: 'active',
    });
    await activity(ctx, { _id: contactId, clientId }, `${fields.name} added as a contact`);
    return contactId;
  },
});

export const update = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts'), ...details },
  handler: async (ctx, { contactId, isBilling, ...args }) => {
    const contact = await getContact(ctx, contactId);
    const fields = checkedDetails(args);
    if (fields.email !== contact.email) {
      // The address is how they sign in; changing it under a live account would hand the account to someone else.
      if (contact.portalAccess || contact.authUserId) {
        throw crmError('crm.emailLocked', 'This contact signs in to the portal with their email. Revoke access first.');
      }
      await assertNoDuplicateOnClient(ctx, contact.clientId, fields.email, contactId);
    }
    // Changing the number withdraws WhatsApp consent, which was given for the old number.
    const whatsappOptIn = fields.whatsapp === contact.whatsapp ? contact.whatsappOptIn : undefined;
    await ctx.db.patch('contacts', contactId, { ...fields, isBilling, whatsappOptIn });
  },
});

export const setPrimary = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => {
    const contact = await getContact(ctx, contactId);
    if (contact.status !== 'active')
      throw crmError('crm.contactLeft', 'Someone who has left cannot be the primary contact');
    for (const other of await clientContacts(ctx, contact.clientId)) {
      if (other.isPrimary !== (other._id === contactId)) {
        await ctx.db.patch('contacts', other._id, { isPrimary: other._id === contactId });
      }
    }
  },
});

/** Records how the contact agreed to WhatsApp messages. Nothing is sent on WhatsApp without it. */
export const recordWhatsappOptIn = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts'), method: optInMethod },
  handler: async (ctx, { contactId, method }) => {
    const contact = await getContact(ctx, contactId);
    if (!contact.whatsapp) throw crmError('crm.invalid', 'Add their WhatsApp number first');
    if (contact.status !== 'active') throw crmError('crm.contactLeft', 'This contact has left');
    await ctx.db.patch('contacts', contactId, {
      whatsappOptIn: { at: Date.now(), method, recordedBy: ctx.principal.member._id },
    });
    await activity(ctx, contact, 'WhatsApp opt-in recorded', METHOD_LABELS[method]);
  },
});

export const withdrawWhatsappOptIn = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => {
    const contact = await getContact(ctx, contactId);
    if (!contact.whatsappOptIn) return;
    await ctx.db.patch('contacts', contactId, { whatsappOptIn: undefined });
    await activity(ctx, contact, 'WhatsApp opt-in withdrawn');
  },
});

const METHOD_LABELS: Record<NonNullable<Doc<'contacts'>['whatsappOptIn']>['method'], string> = {
  portal_checkbox: 'Portal checkbox',
  written_consent: 'Written consent',
  form: 'Form',
};

/**
 * Gives a contact portal access and emails them an invitation. Without a role, the client's first portal contact
 * becomes Client admin and later ones Client member. Turns the portal on for the client if it was off.
 */
export const grantPortalAccess = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts'), roleId: v.optional(v.id('roles')) },
  handler: async (ctx, { contactId, roleId }) => {
    const contact = await getContact(ctx, contactId);
    if (contact.status !== 'active') throw crmError('crm.contactLeft', 'This contact has left');
    if (contact.portalAccess) throw crmError('crm.alreadyInvited', 'This contact already has portal access');
    await assertEmailFreeForPortal(ctx, contact);

    let role: Doc<'roles'> | null;
    if (roleId) {
      role = await clientRole(ctx, roleId);
    } else {
      const everInvited = (await clientContacts(ctx, contact.clientId)).some((c) => c.portalRoleId !== undefined);
      role = await roleByKey(ctx, everInvited ? 'client_member' : 'client_admin');
      if (!role) throw crmError('crm.invalid', 'Client roles are missing; run the seed');
    }

    const client = await getClient(ctx, contact.clientId);
    if (!client.portalEnabled) await ctx.db.patch('clients', client._id, { portalEnabled: true });
    await ctx.db.patch('contacts', contactId, {
      portalAccess: true,
      portalRoleId: role._id,
      portalInvitedAt: Date.now(),
    });
    await activity(ctx, contact, `Portal access given as ${role.name}`);
    await ctx.scheduler.runAfter(0, internal.portalInvites.send, {
      contactId,
      inviterMemberId: ctx.principal.member._id,
    });
  },
});

export const resendPortalInvite = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => {
    const contact = await getContact(ctx, contactId);
    if (!contact.portalAccess || contact.status !== 'active') {
      throw crmError('crm.noPortalAccess', 'This contact does not have portal access');
    }
    await ctx.scheduler.runAfter(0, internal.portalInvites.send, {
      contactId,
      inviterMemberId: ctx.principal.member._id,
    });
  },
});

export const setPortalRole = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts'), roleId: v.id('roles') },
  handler: async (ctx, { contactId, roleId }) => {
    const contact = await getContact(ctx, contactId);
    if (!contact.portalAccess) throw crmError('crm.noPortalAccess', 'Give portal access first');
    const role = await clientRole(ctx, roleId);
    if (contact.portalRoleId === roleId) return;
    await ctx.db.patch('contacts', contactId, { portalRoleId: roleId });
    await activity(ctx, contact, `Portal role changed to ${role.name}`);
  },
});

async function endPortalAccess(ctx: MutationCtx, contact: Doc<'contacts'>) {
  if (contact.authUserId) await revokeAllSessions(ctx, contact.authUserId);
}

/** Removes portal access and signs the contact out at once. The role is kept so it can be given back. */
export const revokePortalAccess = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => {
    const contact = await getContact(ctx, contactId);
    if (!contact.portalAccess) return;
    await ctx.db.patch('contacts', contactId, { portalAccess: false });
    await endPortalAccess(ctx, contact);
    await activity(ctx, contact, 'Portal access removed');
  },
});

/** The contact left the company: portal access ends at once and history stays. */
export const markLeft = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => {
    const contact = await getContact(ctx, contactId);
    if (contact.status === 'left') return;
    await ctx.db.patch('contacts', contactId, {
      status: 'left',
      leftAt: Date.now(),
      portalAccess: false,
      isPrimary: false,
      whatsappOptIn: undefined,
    });
    await endPortalAccess(ctx, contact);
    await activity(ctx, contact, `${contact.name} left ${(await getClient(ctx, contact.clientId)).displayName}`);
  },
});

export const markReturned = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => {
    const contact = await getContact(ctx, contactId);
    if (contact.status === 'active') return;
    await assertNoDuplicateOnClient(ctx, contact.clientId, contact.email, contactId);
    await ctx.db.patch('contacts', contactId, { status: 'active', leftAt: undefined });
    await activity(ctx, contact, `${contact.name} is a contact again`);
  },
});

/** Deletes a contact added by mistake. Anyone who has signed in to the portal is marked as left instead. */
export const remove = teamMutation('contacts.manage')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => {
    const contact = await getContact(ctx, contactId);
    if (contact.authUserId) {
      throw crmError('crm.hasHistory', 'This contact has used the portal. Mark them as left instead.');
    }
    const entries = await ctx.db
      .query('activities')
      .withIndex('by_subject_occurred', (q) => q.eq('subject.table', 'contacts').eq('subject.id', contactId))
      .collect();
    for (const entry of entries) await ctx.db.delete('activities', entry._id);
    await ctx.db.delete('contacts', contactId);
    if (contact.isPrimary) {
      const next = (await clientContacts(ctx, contact.clientId)).find((c) => c.status === 'active');
      if (next) await ctx.db.patch('contacts', next._id, { isPrimary: true });
    }
  },
});
