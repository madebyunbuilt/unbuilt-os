import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { publishBlockers } from './cms';
import {
  type CmsTable,
  cmsError,
  CONTENT_TABLES,
  deployBatchMs,
  editableFields,
  labelOf,
  type PublishableTable,
} from './lib/cms';
import { internalAction, internalMutation, teamMutation, teamQuery } from './lib/functions';

// Putting content on the public website (13-cms-and-website.md, Publishing). Publishing copies the draft into the
// `published` field and asks for a deploy; the website is static and fetches that copy at build time.

const contentTable = v.union(...CONTENT_TABLES.map((name) => v.literal(name)));

/**
 * Joins the deploy that is already waiting, or starts one. The window belongs to the first publish and is not reset by
 * later ones, so a run of publishes becomes a single build rather than a queue of them.
 */
async function queueDeploy(
  ctx: MutationCtx,
  memberId: Id<'teamMembers'>,
  change: { table: string; id: string; label: string; action: string },
): Promise<Id<'publishes'>> {
  const pending = await ctx.db
    .query('publishes')
    .withIndex('by_status', (q) => q.eq('status', 'pending'))
    .first();
  if (pending) {
    await ctx.db.patch('publishes', pending._id, { changes: [...pending.changes, change] });
    return pending._id;
  }

  const publishId = await ctx.db.insert('publishes', {
    requestedBy: memberId,
    requestedAt: Date.now(),
    status: 'pending',
    changes: [change],
  });
  const settings = await ctx.db.query('siteSettings').unique();
  await ctx.scheduler.runAfter(deployBatchMs(settings?.deployBatchSeconds), internal.cmsPublish.runDeploy, {
    publishId,
  });
  return publishId;
}

/** Copies the draft into the copy the website reads. The only place that field is written. */
async function publishDoc(
  ctx: MutationCtx,
  table: PublishableTable,
  id: string,
  memberId: Id<'teamMembers'>,
): Promise<Id<'publishes'>> {
  const docId = ctx.db.normalizeId(table, id);
  const doc = docId ? await ctx.db.get(table, docId) : null;
  if (!doc) throw cmsError('cms.notFound', 'That content is not here');

  const blockers = publishBlockers(table, doc);
  if (blockers.length > 0) {
    throw cmsError('cms.blocked', blockers.map((problem) => problem.message).join('. '));
  }

  await ctx.db.patch(
    table,
    docId as never,
    {
      status: 'published',
      publishedAt: Date.now(),
      published: editableFields(doc),
    } as never,
  );
  return await queueDeploy(ctx, memberId, {
    table,
    id,
    label: labelOf(table, doc),
    action: 'published',
  });
}

export const publish = teamMutation('cms.publish')({
  args: { table: contentTable, id: v.string() },
  handler: async (ctx, { table, id }): Promise<Id<'publishes'>> =>
    await publishDoc(ctx, table, id, ctx.principal.member._id),
});

/**
 * Taking something off the website. The draft stays exactly as it is: unpublishing is about what the public can read,
 * not about throwing the writing away.
 */
export const unpublish = teamMutation('cms.publish')({
  args: { table: contentTable, id: v.string() },
  handler: async (ctx, { table, id }): Promise<Id<'publishes'>> => {
    const docId = ctx.db.normalizeId(table, id);
    const doc = docId ? await ctx.db.get(table, docId) : null;
    if (!doc) throw cmsError('cms.notFound', 'That content is not here');
    await ctx.db.patch(
      table,
      docId as never,
      {
        status: 'draft',
        published: undefined,
        publishedAt: undefined,
      } as never,
    );
    return await queueDeploy(ctx, ctx.principal.member._id, {
      table,
      id,
      label: labelOf(table, doc),
      action: 'unpublished',
    });
  },
});

/**
 * Deleting content. A work that a testimonial still quotes is refused until that changes: the quote would otherwise be
 * left pointing at nothing, and a deploy would carry the gap to the website.
 */
export const remove = teamMutation('cms.publish')({
  args: { table: contentTable, id: v.string() },
  handler: async (ctx, { table, id }): Promise<Id<'publishes'> | null> => {
    const docId = ctx.db.normalizeId(table, id);
    const doc = docId ? await ctx.db.get(table, docId) : null;
    if (!doc) throw cmsError('cms.notFound', 'That content is not here');

    if (table === 'works') {
      const quoting = await ctx.db
        .query('testimonials')
        .withIndex('by_work', (q) => q.eq('workId', docId as Id<'works'>))
        .collect();
      if (quoting.length > 0) {
        throw cmsError(
          'cms.referenced',
          `${quoting.length === 1 ? 'A testimonial quotes' : `${quoting.length} testimonials quote`} this case study. Move them first.`,
        );
      }
    }

    const wasPublished = doc.status === 'published';
    const label = labelOf(table, doc);
    await ctx.db.delete(table, docId as never);
    // Only a deletion the public could see needs a deploy; a draft was never on the website.
    return wasPublished
      ? await queueDeploy(ctx, ctx.principal.member._id, { table, id, label, action: 'deleted' })
      : null;
  },
});

/** Publishing an insight later. It stays out of the website until its date, and can still be edited until then. */
export const schedulePost = teamMutation('cms.publish')({
  args: { postId: v.id('posts'), publishAt: v.number() },
  handler: async (ctx, { postId, publishAt }): Promise<null> => {
    const post = await ctx.db.get('posts', postId);
    if (!post) throw cmsError('cms.notFound', 'That post is not here');
    if (publishAt <= Date.now()) throw cmsError('cms.invalid', 'A scheduled date has to be in the future');
    // Checked now as well as at the time, so a post is not scheduled only to fail quietly at midnight.
    const blockers = publishBlockers('posts', post);
    if (blockers.length > 0) {
      throw cmsError('cms.blocked', blockers.map((problem) => problem.message).join('. '));
    }
    await ctx.db.patch('posts', postId, { status: 'scheduled', publishAt });
    await ctx.scheduler.runAt(publishAt, internal.cmsPublish.publishScheduled, {
      postId,
      memberId: ctx.principal.member._id,
    });
    return null;
  },
});

export const unschedulePost = teamMutation('cms.publish')({
  args: { postId: v.id('posts') },
  handler: async (ctx, { postId }): Promise<null> => {
    const post = await ctx.db.get('posts', postId);
    if (!post || post.status !== 'scheduled') throw cmsError('cms.notFound', 'That post is not scheduled');
    await ctx.db.patch('posts', postId, { status: 'draft', publishAt: undefined });
    return null;
  },
});

/** The scheduled publish itself. It checks the post is still scheduled, because it may have been changed since. */
export const publishScheduled = internalMutation({
  args: { postId: v.id('posts'), memberId: v.id('teamMembers') },
  handler: async (ctx, { postId, memberId }): Promise<null> => {
    const post = await ctx.db.get('posts', postId);
    // Unscheduled, published by hand, or deleted in the meantime: all ordinary, and none of them an error.
    if (!post || post.status !== 'scheduled') return null;
    await publishDoc(ctx, 'posts', postId, memberId);
    return null;
  },
});

// The deploy ----------------------------------------------------------------------------------------------------------

/** Firing the waiting deploy now, for the times somebody does not want to wait out the window. */
export const deployNow = teamMutation('cms.publish')({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const pending = await ctx.db
      .query('publishes')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .first();
    if (!pending) return false;
    await ctx.scheduler.runAfter(0, internal.cmsPublish.runDeploy, { publishId: pending._id });
    return true;
  },
});

/**
 * Claims the batch for this run, in one transaction. Two runs can arrive at once — the waiting one and an immediate one
 * from `deployNow` — and an action is not transactional, so both would read the row as pending and both would call the
 * hook. Only the writer that moves it out of `pending` here goes on to build.
 *
 * `deployHookCalledAt` is set on the claim rather than on the answer, because the window is about when a build starts.
 */
export const claimDeploy = internalMutation({
  args: { publishId: v.id('publishes') },
  handler: async (ctx, { publishId }): Promise<{ claimed: boolean; waitMs: number; url?: string }> => {
    const row = await ctx.db.get('publishes', publishId);
    if (!row || row.status !== 'pending') return { claimed: false, waitMs: 0 };

    const settings = await ctx.db.query('siteSettings').unique();
    const batchMs = deployBatchMs(settings?.deployBatchSeconds);
    const previous = await ctx.db
      .query('publishes')
      .order('desc')
      .take(50)
      .then((rows) => rows.filter((other) => other._id !== publishId && other.deployHookCalledAt !== undefined));
    const lastCalledAt = Math.max(0, ...previous.map((other) => other.deployHookCalledAt ?? 0));

    // Two builds started seconds apart race, and the loser is whichever finishes second. There is no callback saying a
    // build has finished, so this is the honest version of "not while one is in flight": one hook call per window.
    const since = Date.now() - lastCalledAt;
    if (lastCalledAt > 0 && since < batchMs) return { claimed: false, waitMs: batchMs - since };

    await ctx.db.patch('publishes', publishId, { status: 'deploying', deployHookCalledAt: Date.now() });
    return { claimed: true, waitMs: 0 };
  },
});

export const finishDeploy = internalMutation({
  args: {
    publishId: v.id('publishes'),
    status: v.union(v.literal('deployed'), v.literal('failed')),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { publishId, status, error }): Promise<null> => {
    await ctx.db.patch('publishes', publishId, { status, error });
    return null;
  },
});

/**
 * Calls the website's deploy hook. The website's own pipeline is not involved: a content deploy is a rebuild of the
 * same code against new content.
 *
 * Two builds started seconds apart would race, and the loser is whichever finishes second, so a deploy that would
 * follow too closely on the last one waits out the rest of the window instead. There is no callback saying a build has
 * finished, so this is the honest version of "not while one is in flight": never call the hook twice inside a window.
 */
export const runDeploy = internalAction({
  args: { publishId: v.id('publishes') },
  handler: async (ctx, { publishId }): Promise<null> => {
    const { claimed, waitMs } = await ctx.runMutation(internal.cmsPublish.claimDeploy, { publishId });
    if (!claimed) {
      // Either somebody else has it, or the last build is too recent. A wait is rescheduled; a loss is simply over.
      if (waitMs > 0) await ctx.scheduler.runAfter(waitMs, internal.cmsPublish.runDeploy, { publishId });
      return null;
    }

    const url = process.env.WEBSITE_DEPLOY_HOOK_URL;
    if (!url) {
      // Said out loud rather than passed over: on a deployment without the hook, content publishes and the website does
      // not rebuild, and somebody should be able to see why.
      await ctx.runMutation(internal.cmsPublish.finishDeploy, {
        publishId,
        status: 'failed',
        error: 'WEBSITE_DEPLOY_HOOK_URL is not set on this deployment, so the website was not rebuilt',
      });
      return null;
    }

    try {
      const response = await fetch(url, { method: 'POST' });
      await ctx.runMutation(internal.cmsPublish.finishDeploy, {
        publishId,
        status: response.ok ? 'deployed' : 'failed',
        error: response.ok ? undefined : `The deploy hook answered ${response.status}`,
      });
    } catch (caught) {
      await ctx.runMutation(internal.cmsPublish.finishDeploy, {
        publishId,
        status: 'failed',
        error: caught instanceof Error ? caught.message : 'The deploy hook could not be reached',
      });
    }
    return null;
  },
});

/** Retrying a deploy that failed, without republishing anything: the content is already published. */
export const retryDeploy = teamMutation('cms.publish')({
  args: { publishId: v.id('publishes') },
  handler: async (ctx, { publishId }): Promise<null> => {
    const row = await ctx.db.get('publishes', publishId);
    if (!row) throw cmsError('cms.notFound', 'That deploy is not here');
    if (row.status !== 'failed') throw cmsError('cms.invalid', 'Only a failed deploy can be retried');
    await ctx.db.patch('publishes', publishId, { status: 'pending', error: undefined, deployHookCalledAt: undefined });
    await ctx.scheduler.runAfter(0, internal.cmsPublish.runDeploy, { publishId });
    return null;
  },
});

/**
 * What the screen shows while a publish is on its way: how long the wait has left, and how the last deploys went. Said
 * plainly, because a minute of silence after pressing Publish reads as a broken button.
 */
export const deployState = teamQuery('cms.view')({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query('siteSettings').unique();
    const batchMs = deployBatchMs(settings?.deployBatchSeconds);
    const pending = await ctx.db
      .query('publishes')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .first();
    const recent = await ctx.db.query('publishes').order('desc').take(10);
    return {
      batchSeconds: Math.round(batchMs / 1000),
      pending: pending
        ? {
            id: pending._id,
            changes: pending.changes,
            requestedAt: pending.requestedAt,
            // What the countdown counts down to. The page works this out against its own clock from here.
            deployAt: pending.requestedAt + batchMs,
          }
        : null,
      recent: await Promise.all(
        recent.map(async (row) => ({
          id: row._id,
          status: row.status,
          requestedAt: row.requestedAt,
          deployHookCalledAt: row.deployHookCalledAt,
          error: row.error,
          changes: row.changes,
          requestedByName: (await ctx.db.get('teamMembers', row.requestedBy))?.name ?? 'Somebody',
        })),
      ),
    };
  },
});

/** Changing how long publishing waits before it builds. A setting, because the right number is a studio preference. */
export const setDeployBatchSeconds = teamMutation('cms.settings.manage')({
  args: { seconds: v.number() },
  handler: async (ctx, { seconds }): Promise<number> => {
    const row = await ctx.db.query('siteSettings').unique();
    if (!row) throw cmsError('cms.notFound', 'Site settings have not been set up on this deployment');
    const clamped = Math.round(deployBatchMs(seconds) / 1000);
    await ctx.db.patch('siteSettings', row._id, { deployBatchSeconds: clamped, draftUpdatedAt: Date.now() });
    return clamped;
  },
});

export type { CmsTable };
