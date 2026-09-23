import { v } from 'convex/values';
import { type Doc } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { portalMutation, portalQuery, teamMutation, teamQuery } from './lib/functions';
import { authError } from './lib/principals';

// In-app notifications (14-platform.md, Notifications): the bell, the list and read state. Every principal reads only
// their own. Creating notifications, and email and WhatsApp delivery, arrive with the communications step.

const LIST_LIMIT = 50;
/** The badge shows "99+" beyond this. */
export const UNREAD_COUNT_CAP = 99;

type Recipient = { kind: 'team' | 'client'; id: string };

function toClient(notification: Doc<'notifications'>) {
  return {
    id: notification._id,
    event: notification.event,
    title: notification.title,
    body: notification.body,
    link: notification.link?.startsWith('/') ? notification.link : undefined,
    read: notification.readAt !== undefined,
    createdAt: notification.createdAt,
  };
}

function unread(ctx: QueryCtx | MutationCtx, recipient: Recipient) {
  return ctx.db
    .query('notifications')
    .withIndex('by_recipient_read', (q) =>
      q.eq('recipientKind', recipient.kind).eq('recipientId', recipient.id).eq('readAt', undefined),
    );
}

async function list(ctx: QueryCtx, recipient: Recipient) {
  const items = await ctx.db
    .query('notifications')
    .withIndex('by_recipient_created', (q) => q.eq('recipientKind', recipient.kind).eq('recipientId', recipient.id))
    .order('desc')
    .take(LIST_LIMIT);
  const unreadItems = await unread(ctx, recipient).take(UNREAD_COUNT_CAP + 1);
  return { items: items.map(toClient), unreadCount: unreadItems.length };
}

/** How many a page of the full list holds. */
const PAGE = 30;

/**
 * A page of someone's notifications, newest first, for the notifications screen: everything, or only the unread, from
 * before `before` (the createdAt of the last one seen).
 */
async function feed(
  ctx: QueryCtx,
  recipient: Recipient,
  { before, unreadOnly }: { before?: number; unreadOnly?: boolean },
) {
  const rows = unreadOnly
    ? await unread(ctx, recipient)
        .order('desc')
        .filter((q) => (before === undefined ? true : q.lt(q.field('createdAt'), before)))
        .take(PAGE + 1)
    : await ctx.db
        .query('notifications')
        .withIndex('by_recipient_created', (q) => {
          const scoped = q.eq('recipientKind', recipient.kind).eq('recipientId', recipient.id);
          return before === undefined ? scoped : scoped.lt('createdAt', before);
        })
        .order('desc')
        .take(PAGE + 1);
  const items = rows.slice(0, PAGE);
  const unreadItems = await unread(ctx, recipient).take(UNREAD_COUNT_CAP + 1);
  return {
    items: items.map(toClient),
    unreadCount: unreadItems.length,
    // The cursor for the next page; absent when there is nothing older.
    nextBefore: rows.length > PAGE ? items.at(-1)?.createdAt : undefined,
  };
}

async function markRead(ctx: MutationCtx, recipient: Recipient, notificationId: Doc<'notifications'>['_id']) {
  const notification = await ctx.db.get('notifications', notificationId);
  if (!notification || notification.recipientKind !== recipient.kind || notification.recipientId !== recipient.id) {
    throw authError('auth.notFound', 'Notification not found');
  }
  if (notification.readAt === undefined) await ctx.db.patch('notifications', notificationId, { readAt: Date.now() });
}

async function markAllRead(ctx: MutationCtx, recipient: Recipient) {
  const now = Date.now();
  for (const notification of await unread(ctx, recipient).take(500)) {
    await ctx.db.patch('notifications', notification._id, { readAt: now });
  }
}

const notificationId = v.id('notifications');

export const teamList = teamQuery(null)({
  args: {},
  handler: (ctx) => list(ctx, { kind: 'team', id: ctx.principal.member._id }),
});

export const teamMarkRead = teamMutation(null)({
  args: { notificationId },
  handler: (ctx, args) => markRead(ctx, { kind: 'team', id: ctx.principal.member._id }, args.notificationId),
});

export const teamMarkAllRead = teamMutation(null)({
  args: {},
  handler: (ctx) => markAllRead(ctx, { kind: 'team', id: ctx.principal.member._id }),
});

export const teamFeed = teamQuery(null)({
  args: { before: v.optional(v.number()), unreadOnly: v.optional(v.boolean()) },
  handler: (ctx, args) => feed(ctx, { kind: 'team', id: ctx.principal.member._id }, args),
});

export const portalFeed = portalQuery(null)({
  args: { before: v.optional(v.number()), unreadOnly: v.optional(v.boolean()) },
  handler: (ctx, args) => feed(ctx, { kind: 'client', id: ctx.principal.contact._id }, args),
});

export const portalList = portalQuery(null)({
  args: {},
  handler: (ctx) => list(ctx, { kind: 'client', id: ctx.principal.contact._id }),
});

export const portalMarkRead = portalMutation(null)({
  args: { notificationId },
  handler: (ctx, args) => markRead(ctx, { kind: 'client', id: ctx.principal.contact._id }, args.notificationId),
});

export const portalMarkAllRead = portalMutation(null)({
  args: {},
  handler: (ctx) => markAllRead(ctx, { kind: 'client', id: ctx.principal.contact._id }),
});
