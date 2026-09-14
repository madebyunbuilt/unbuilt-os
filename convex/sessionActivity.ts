import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, internalQuery, teamMutation } from './lib/functions';
import { lastActiveAt } from './lib/principals';

// Real activity for the 12-hour idle rule (03-auth-and-permissions.md). The team app reports clicks, typing, scrolling
// and touches at most every few minutes; token renewals in the background never count.

/** Heartbeats closer together than this are not written again. */
export const RECORD_INTERVAL_MS = 60_000;
/** Rows older than this belong to sessions that are already idle or gone. */
export const ACTIVITY_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH = 200;

/** Called by the team app when the person uses it. Fails like any team function once the session is idle. */
export const record = teamMutation(null)({
  args: {},
  handler: async (ctx) => {
    const { sessionId, authUserId } = ctx.principal.session;
    const now = Date.now();
    const existing = await ctx.db
      .query('sessionActivity')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .unique();
    if (!existing) {
      await ctx.db.insert('sessionActivity', { sessionId, authUserId, lastActiveAt: now });
    } else if (now - existing.lastActiveAt >= RECORD_INTERVAL_MS) {
      await ctx.db.patch('sessionActivity', existing._id, { lastActiveAt: now });
    }
  },
});

/** For the Better Auth idle hook, which runs outside the function wrappers. */
export const lastActive = internalQuery({
  args: { sessionId: v.string(), createdAt: v.number() },
  returns: v.number(),
  handler: async (ctx, { sessionId, createdAt }) => await lastActiveAt(ctx, { _id: sessionId, createdAt }),
});

/** Daily: removes activity for sessions idle long past the limit or already ended. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ACTIVITY_RETENTION_MS;
    const stale = await ctx.db
      .query('sessionActivity')
      .withIndex('by_lastActive', (q) => q.lt('lastActiveAt', cutoff))
      .take(CLEANUP_BATCH);
    for (const row of stale) await ctx.db.delete('sessionActivity', row._id);
    if (stale.length === CLEANUP_BATCH) await ctx.scheduler.runAfter(0, internal.sessionActivity.cleanup, {});
    return { deleted: stale.length };
  },
});
