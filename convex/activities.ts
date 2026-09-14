import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import {
  type ActivitySubject,
  crmError,
  getClient,
  getContact,
  mentionedMemberIds,
  plainMentions,
  requirePermission,
  text,
} from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { notifyTeamMembers } from './lib/notify';
import { type TeamPrincipal } from './lib/principals';

// The activity timeline (05-crm.md, Activity timeline). Anyone who can view a client adds notes, calls and meetings to
// it and its contacts; authors edit and delete their own, and the Owner and Admins (clients.delete) can delete anyone's.
// Automatic entries cannot be changed. Deals, projects and tickets add their subjects when those modules arrive.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };

const MANUAL_TYPES = ['note', 'call', 'meeting'] as const;
const MAX_BODY = 5000;
const DEFAULT_TITLES: Record<(typeof MANUAL_TYPES)[number], string> = {
  note: 'Note',
  call: 'Call',
  meeting: 'Meeting',
};

const subject = v.object({ table: v.union(v.literal('clients'), v.literal('contacts')), id: v.string() });
const manualType = v.union(v.literal('note'), v.literal('call'), v.literal('meeting'));

/** Checks the caller may see the subject and returns the client it belongs to. */
async function resolveSubject(ctx: Ctx & Principal, target: ActivitySubject): Promise<Id<'clients'>> {
  requirePermission(ctx.principal, 'clients.view');
  switch (target.table) {
    case 'clients': {
      const id = ctx.db.normalizeId('clients', target.id);
      if (!id) throw crmError('crm.notFound', 'Client not found');
      return (await getClient(ctx, id))._id;
    }
    case 'contacts': {
      const id = ctx.db.normalizeId('contacts', target.id);
      if (!id) throw crmError('crm.notFound', 'Contact not found');
      return (await getContact(ctx, id)).clientId;
    }
    default:
      throw crmError('crm.invalid', 'This timeline is not available yet');
  }
}

const isManual = (entry: Doc<'activities'>) => (MANUAL_TYPES as readonly string[]).includes(entry.type);

function canEdit(principal: TeamPrincipal, entry: Doc<'activities'>) {
  return isManual(entry) && entry.actorKind === 'team' && entry.actorId === principal.member._id;
}

function canDelete(principal: TeamPrincipal, entry: Doc<'activities'>) {
  return isManual(entry) && (canEdit(principal, entry) || principal.permissions.has('clients.delete'));
}

/** A client's timeline includes everything linked to it; any other subject shows only its own entries. */
export const list = teamQuery(null)({
  args: { subject, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { subject: target, paginationOpts }) => {
    const clientId = await resolveSubject(ctx, target);
    const query =
      target.table === 'clients'
        ? ctx.db.query('activities').withIndex('by_client_occurred', (q) => q.eq('clientId', clientId))
        : ctx.db
            .query('activities')
            .withIndex('by_subject_occurred', (q) => q.eq('subject.table', target.table).eq('subject.id', target.id));
    const page = await query.order('desc').paginate(paginationOpts);

    const names = new Map<string, string>();
    const actorName = async (entry: Doc<'activities'>) => {
      if (entry.actorKind === 'system' || !entry.actorId) return 'Unbuilt OS';
      if (!names.has(entry.actorId)) {
        const id =
          entry.actorKind === 'team'
            ? ctx.db.normalizeId('teamMembers', entry.actorId)
            : ctx.db.normalizeId('contacts', entry.actorId);
        const actor = id ? await ctx.db.get(id) : null;
        names.set(entry.actorId, actor && 'name' in actor ? actor.name : 'Former member');
      }
      return names.get(entry.actorId)!;
    };

    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (entry) => ({
          id: entry._id,
          subject: entry.subject,
          type: entry.type,
          title: entry.title,
          body: entry.body,
          actorKind: entry.actorKind,
          actorName: await actorName(entry),
          occurredAt: entry.occurredAt,
          editedAt: entry.editedAt,
          canEdit: canEdit(ctx.principal, entry),
          canDelete: canDelete(ctx.principal, entry),
        })),
      ),
    };
  },
});

function checkedBody(body: string): string {
  const value = text(body, 'The note', { required: true, max: MAX_BODY })!;
  return value;
}

function checkedOccurredAt(occurredAt: number | undefined): number {
  const now = Date.now();
  if (occurredAt === undefined) return now;
  // Calls and meetings can be logged afterwards, or a meeting ahead of time, within a year either way.
  if (!Number.isSafeInteger(occurredAt) || Math.abs(occurredAt - now) > 366 * 86_400_000) {
    throw crmError('crm.invalid', 'Choose a date within a year of today');
  }
  return occurredAt;
}

/** Active team members mentioned in the body, other than the author. */
async function validMentions(ctx: Ctx, body: string): Promise<Id<'teamMembers'>[]> {
  const ids: Id<'teamMembers'>[] = [];
  for (const raw of mentionedMemberIds(body)) {
    const id = ctx.db.normalizeId('teamMembers', raw);
    const member = id ? await ctx.db.get('teamMembers', id) : null;
    if (member?.status === 'active') ids.push(member._id);
  }
  return ids;
}

async function notifyMentions(
  ctx: MutationCtx & Principal,
  memberIds: Id<'teamMembers'>[],
  clientId: Id<'clients'>,
  body: string,
) {
  const me = ctx.principal.member;
  const recipients = memberIds.filter((id) => id !== me._id);
  if (recipients.length === 0) return;
  const client = await getClient(ctx, clientId);
  const plain = plainMentions(body);
  await notifyTeamMembers(ctx, recipients, {
    event: 'mention',
    title: `${me.name} mentioned you on ${client.displayName}`,
    body: plain.length > 200 ? `${plain.slice(0, 199)}…` : plain,
    link: `/crm/clients/${clientId}`,
  });
}

export const add = teamMutation(null)({
  args: {
    subject,
    type: manualType,
    title: v.optional(v.string()),
    body: v.string(),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const clientId = await resolveSubject(ctx, args.subject);
    const body = checkedBody(args.body);
    const mentions = await validMentions(ctx, body);
    const id = await ctx.db.insert('activities', {
      subject: args.subject,
      clientId,
      type: args.type,
      title: text(args.title, 'Title', { max: 120 }) ?? DEFAULT_TITLES[args.type],
      body,
      actorKind: 'team',
      actorId: ctx.principal.member._id,
      occurredAt: checkedOccurredAt(args.occurredAt),
      mentions,
    });
    await notifyMentions(ctx, mentions, clientId, body);
    return id;
  },
});

async function getEntry(ctx: Ctx & Principal, activityId: Id<'activities'>) {
  const entry = await ctx.db.get('activities', activityId);
  if (!entry) throw crmError('crm.notFound', 'Timeline entry not found');
  await resolveSubject(ctx, entry.subject);
  return entry;
}

/** Authors edit their own notes, calls and meetings. Newly mentioned members are notified. */
export const update = teamMutation(null)({
  args: {
    activityId: v.id('activities'),
    title: v.optional(v.string()),
    body: v.string(),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entry = await getEntry(ctx, args.activityId);
    if (!canEdit(ctx.principal, entry)) {
      throw crmError(
        'crm.cannotEdit',
        isManual(entry) ? 'Only the author can edit this' : 'Automatic entries cannot be edited',
      );
    }
    const body = checkedBody(args.body);
    const mentions = await validMentions(ctx, body);
    await ctx.db.patch('activities', entry._id, {
      title: text(args.title, 'Title', { max: 120 }) ?? entry.title,
      body,
      occurredAt: args.occurredAt === undefined ? entry.occurredAt : checkedOccurredAt(args.occurredAt),
      mentions,
      editedAt: Date.now(),
    });
    const before = new Set(entry.mentions ?? []);
    if (entry.clientId) {
      await notifyMentions(
        ctx,
        mentions.filter((id) => !before.has(id)),
        entry.clientId,
        body,
      );
    }
  },
});

/** Authors delete their own entries; the Owner and Admins delete anyone's. The audit log keeps what was removed. */
export const remove = teamMutation(null)({
  args: { activityId: v.id('activities') },
  handler: async (ctx, { activityId }) => {
    const entry = await getEntry(ctx, activityId);
    if (!canDelete(ctx.principal, entry)) {
      throw crmError(
        'crm.cannotDelete',
        isManual(entry)
          ? 'Only the author, the Owner or an Admin can delete this'
          : 'Automatic entries cannot be deleted',
      );
    }
    await ctx.db.delete('activities', activityId);
  },
});
