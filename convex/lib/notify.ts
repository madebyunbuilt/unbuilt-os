import { type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type TeamPermission } from './permissions';

// Creating in-app notifications (14-platform.md, Notifications). Email and WhatsApp delivery arrive with the
// communications step; until then `channels` records in-app only.

export type TeamNotification = { event: string; title: string; body: string; link?: string };

export async function notifyTeamMembers(
  ctx: { db: MutationCtx['db'] },
  memberIds: Iterable<Id<'teamMembers'>>,
  notification: TeamNotification,
): Promise<void> {
  const createdAt = Date.now();
  for (const memberId of new Set(memberIds)) {
    await ctx.db.insert('notifications', {
      recipientKind: 'team',
      recipientId: memberId,
      ...notification,
      channels: { inApp: true },
      createdAt,
    });
  }
}

/** Active team members whose role holds `permission`. */
export async function activeMembersWith(
  ctx: QueryCtx | MutationCtx,
  permission: TeamPermission,
): Promise<Id<'teamMembers'>[]> {
  const roles = await ctx.db
    .query('roles')
    .withIndex('by_kind', (q) => q.eq('kind', 'team'))
    .collect();
  const ids: Id<'teamMembers'>[] = [];
  for (const role of roles.filter((r) => r.permissions.includes(permission))) {
    const members = await ctx.db
      .query('teamMembers')
      .withIndex('by_role', (q) => q.eq('roleId', role._id))
      .collect();
    ids.push(...members.filter((m) => m.status === 'active').map((m) => m._id));
  }
  return ids;
}

export type ClientNotification = TeamNotification;

/**
 * Tells the client's own people, in the portal (14-platform.md, Notifications). Only contacts with portal access are
 * written to: a notification nobody can open is noise, and the portal is where these are read.
 */
export async function notifyClientContacts(
  ctx: { db: MutationCtx['db'] },
  contactIds: Iterable<Id<'contacts'>>,
  notification: ClientNotification,
): Promise<void> {
  const createdAt = Date.now();
  for (const contactId of new Set(contactIds)) {
    const contact = await ctx.db.get('contacts', contactId);
    if (!contact || contact.status !== 'active' || !contact.portalAccess) continue;
    await ctx.db.insert('notifications', {
      recipientKind: 'client',
      recipientId: contactId,
      ...notification,
      channels: { inApp: true },
      createdAt,
    });
  }
}

/** The client's people who should hear about a project: those with portal access on that client. */
export async function clientPortalContacts(
  ctx: QueryCtx | MutationCtx,
  clientId: Id<'clients'>,
): Promise<Id<'contacts'>[]> {
  const contacts = await ctx.db
    .query('contacts')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  return contacts.filter((contact) => contact.status === 'active' && contact.portalAccess).map((c) => c._id);
}
