import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, type TestConvex } from './test.auth';

// Putting content on the website (13-cms-and-website.md, Publishing). The rule this is all built around: a run of
// publishes is one build, because the website is static and rebuilding it five times leaves four stale builds behind.

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

const GOOD_SEO = {
  title: 'Glossup: a shop that loads fast',
  description:
    'How Unbuilt Studio rebuilt Glossup as a mobile app and a web platform, and cut the time a page takes to load from four seconds to under one second.',
};

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let editor: Awaited<ReturnType<typeof createTeamMember>>;
let hook: ReturnType<typeof vi.fn>;

const work = (overrides: object = {}) => ({
  slug: 'glossup',
  name: 'Glossup',
  art: 'glossup',
  listLine: 'A shop that loads fast',
  listDetail: 'Mobile app and web platform',
  seo: GOOD_SEO,
  summary: 'A rebuild of the whole shop.',
  meta: { client: 'Glossup', year: '2026', role: 'Design and build', status: 'Live' },
  stack: ['Expo'],
  brief: ['Make it fast'],
  hardPart: ['Images'],
  built: ['An app'],
  shots: [{ alt: 'The product list', caption: 'Products', frame: 'phone' as const }],
  ...overrides,
});

/** A work that is allowed to be published: SEO in range, alt text written, and the client's permission recorded. */
async function publishableWork(overrides: object = {}): Promise<Id<'works'>> {
  const workId = await editor.as.mutation(api.cms.createWork, work(overrides));
  await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: true });
  return workId;
}

const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
const deploys = async () => await t.run((ctx) => ctx.db.query('publishes').collect());

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
  vi.stubEnv('WEBSITE_DEPLOY_HOOK_URL', 'https://api.vercel.com/v1/integrations/deploy/abc');
  hook = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', hook);
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  editor = await createTeamMember(t, roles.content_editor, { email: 'ife@unbuilt.studio', name: 'Ife Okon' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('publishing one thing', () => {
  it('copies the draft into what the website reads', async () => {
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });

    const stored = await t.run((ctx) => ctx.db.get('works', workId));
    expect(stored!.status).toBe('published');
    expect(stored!.publishedAt).toBe(Date.now());
    expect((stored!.published as { listLine: string }).listLine).toBe('A shop that loads fast');
  });

  it('refuses to publish something that is not ready, and says everything that is wrong', async () => {
    const workId = await editor.as.mutation(
      api.cms.createWork,
      work({ seo: { title: 'x'.repeat(50), description: 'short' } }),
    );
    const error = await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId }).then(
      () => null,
      (e: unknown) => e,
    );
    const message = (error as ConvexError<{ code: string; message: string }>).data;
    expect(message.code).toBe('cms.blocked');
    expect(message.message).toContain('50 characters');
    expect(message.message).toContain('permission');
    // Nothing reached the website, and no deploy was asked for.
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.status).toBe('draft');
    expect(await deploys()).toHaveLength(0);
  });

  it('will not let somebody who may only edit publish', async () => {
    const workId = await publishableWork();
    const writer = await createTeamMember(t, roles.member, { email: 'segun@unbuilt.studio', name: 'Segun' });
    await expectCode(writer.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId }), 'auth.forbidden');
  });
});

describe('several publishes, one build', () => {
  it('calls the deploy hook exactly once for everything inside the window', async () => {
    const first = await publishableWork({ slug: 'one', name: 'One', seo: { ...GOOD_SEO, title: 'One' } });
    const second = await publishableWork({ slug: 'two', name: 'Two', seo: { ...GOOD_SEO, title: 'Two' } });

    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: first });
    vi.setSystemTime(Date.parse('2026-10-12T09:00:30Z'));
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: second });

    // Both joined one waiting deploy rather than starting two.
    expect(await deploys()).toHaveLength(1);
    await runScheduled();

    expect(hook).toHaveBeenCalledTimes(1);
    const [row] = await deploys();
    expect(row.status).toBe('deployed');
    expect(row.changes.map((change) => change.label)).toEqual(['One', 'Two']);
  });

  it('counts the window from the first publish, so a slow run still deploys', async () => {
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    const [pending] = await deploys();

    // A second publish 50 seconds later joins the batch and does not push the deploy back.
    vi.setSystemTime(Date.parse('2026-10-12T09:00:50Z'));
    const other = await publishableWork({ slug: 'two', name: 'Two', seo: { ...GOOD_SEO, title: 'Two' } });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: other });

    const state = await editor.as.query(api.cmsPublish.deployState, {});
    expect(state.pending!.deployAt).toBe(pending.requestedAt + 60_000);
    expect(state.batchSeconds).toBe(60);
  });

  it('starts a fresh window for a publish after the deploy has gone', async () => {
    const first = await publishableWork({ slug: 'one', name: 'One', seo: { ...GOOD_SEO, title: 'One' } });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: first });
    await runScheduled();
    expect(hook).toHaveBeenCalledTimes(1);

    // Far enough past the last build that the next one does not have to wait for it.
    vi.setSystemTime(Date.parse('2026-10-12T09:05:00Z'));
    const second = await publishableWork({ slug: 'two', name: 'Two', seo: { ...GOOD_SEO, title: 'Two' } });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: second });
    await runScheduled();

    expect(hook).toHaveBeenCalledTimes(2);
    expect(await deploys()).toHaveLength(2);
  });

  it('holds a deploy back rather than starting a build on top of one that just went', async () => {
    const first = await publishableWork({ slug: 'one', name: 'One', seo: { ...GOOD_SEO, title: 'One' } });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: first });
    await runScheduled();
    expect(hook).toHaveBeenCalledTimes(1);

    // Published five seconds after the last build started: too close, so the hook waits out the rest of the window.
    vi.setSystemTime(Date.parse('2026-10-12T09:01:05Z'));
    const second = await publishableWork({ slug: 'two', name: 'Two', seo: { ...GOOD_SEO, title: 'Two' } });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: second });
    await editor.as.mutation(api.cmsPublish.deployNow, {});
    await runScheduled();

    // It still happens — it is held, not dropped.
    expect(hook).toHaveBeenCalledTimes(2);
    expect((await deploys()).every((row) => row.status === 'deployed')).toBe(true);
  });
});

describe('not waiting', () => {
  it('deploys at once when asked, and the waiting run then has nothing left to do', async () => {
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });

    expect(await editor.as.mutation(api.cmsPublish.deployNow, {})).toBe(true);
    await runScheduled();

    // The scheduled run arrives later and finds the row already dealt with: one build, not two.
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('says there was nothing waiting, rather than starting an empty build', async () => {
    expect(await editor.as.mutation(api.cmsPublish.deployNow, {})).toBe(false);
    await runScheduled();
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('when the deploy does not work', () => {
  it('says the hook is not set up rather than pretending the website rebuilt', async () => {
    vi.stubEnv('WEBSITE_DEPLOY_HOOK_URL', '');
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    await runScheduled();

    const [row] = await deploys();
    expect(row.status).toBe('failed');
    expect(row.error).toContain('WEBSITE_DEPLOY_HOOK_URL');
    // The content is still published: what failed is the rebuild, not the publish.
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.status).toBe('published');
  });

  it('records what the hook answered, and can be retried without republishing', async () => {
    hook.mockResolvedValue({ ok: false, status: 503 });
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    await runScheduled();
    const [failed] = await deploys();
    expect(failed).toMatchObject({ status: 'failed', error: 'The deploy hook answered 503' });

    hook.mockResolvedValue({ ok: true, status: 200 });
    vi.setSystemTime(Date.parse('2026-10-12T09:10:00Z'));
    await editor.as.mutation(api.cmsPublish.retryDeploy, { publishId: failed._id });
    await runScheduled();
    expect((await deploys())[0].status).toBe('deployed');
  });

  it('records a hook that could not be reached at all', async () => {
    hook.mockRejectedValue(new Error('network unreachable'));
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    await runScheduled();
    expect((await deploys())[0]).toMatchObject({ status: 'failed', error: 'network unreachable' });
  });

  it('refuses to retry a deploy that worked', async () => {
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    await runScheduled();
    await expectCode(
      editor.as.mutation(api.cmsPublish.retryDeploy, { publishId: (await deploys())[0]._id }),
      'cms.invalid',
    );
  });
});

describe('taking things off the website', () => {
  it('unpublishes without throwing the writing away', async () => {
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    await runScheduled();

    vi.setSystemTime(Date.parse('2026-10-12T09:10:00Z'));
    await editor.as.mutation(api.cmsPublish.unpublish, { table: 'works', id: workId });
    const stored = await t.run((ctx) => ctx.db.get('works', workId));
    expect(stored!.status).toBe('draft');
    expect(stored).not.toHaveProperty('published');
    // The draft is untouched, so it can go back up as it was.
    expect(stored!.listLine).toBe('A shop that loads fast');
    expect((await deploys()).at(-1)!.changes[0].action).toBe('unpublished');
  });

  it('refuses to delete a case study a testimonial still quotes', async () => {
    const workId = await publishableWork();
    await editor.as.mutation(api.cms.createTestimonial, {
      quote: 'They shipped it.',
      authorName: 'Ada Eze',
      authorRole: 'Founder',
      workId,
    });
    await expectCode(editor.as.mutation(api.cmsPublish.remove, { table: 'works', id: workId }), 'cms.referenced');
    expect(await t.run((ctx) => ctx.db.get('works', workId))).not.toBeNull();
  });

  it('asks for no build when what was deleted was never on the website', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work({ slug: 'draft-only' }));
    expect(await editor.as.mutation(api.cmsPublish.remove, { table: 'works', id: workId })).toBeNull();
    await runScheduled();
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('insights that publish themselves', () => {
  const post = {
    slug: 'why-fast',
    title: 'Why fast matters',
    excerpt: 'Because people leave.',
    body: [{ kind: 'paragraph', text: 'They do.' }],
    tags: ['performance'],
    seo: GOOD_SEO,
  };

  it('goes out on its date, and asks for a build then', async () => {
    const postId = await editor.as.mutation(api.cms.createPost, post);
    const publishAt = Date.parse('2026-10-13T09:00:00Z');
    await editor.as.mutation(api.cmsPublish.schedulePost, { postId, publishAt });
    expect((await t.run((ctx) => ctx.db.get('posts', postId)))!.status).toBe('scheduled');
    expect(hook).not.toHaveBeenCalled();

    vi.setSystemTime(publishAt);
    await runScheduled();

    const stored = await t.run((ctx) => ctx.db.get('posts', postId));
    expect(stored!.status).toBe('published');
    expect(stored!.published).toBeTruthy();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('does nothing when it was unscheduled in the meantime', async () => {
    const postId = await editor.as.mutation(api.cms.createPost, post);
    const publishAt = Date.parse('2026-10-13T09:00:00Z');
    await editor.as.mutation(api.cmsPublish.schedulePost, { postId, publishAt });
    await editor.as.mutation(api.cmsPublish.unschedulePost, { postId });

    vi.setSystemTime(publishAt);
    await runScheduled();
    expect((await t.run((ctx) => ctx.db.get('posts', postId)))!.status).toBe('draft');
    expect(hook).not.toHaveBeenCalled();
  });

  it('refuses a date in the past, and a post that could not be published anyway', async () => {
    const postId = await editor.as.mutation(api.cms.createPost, post);
    await expectCode(
      editor.as.mutation(api.cmsPublish.schedulePost, { postId, publishAt: Date.now() - 1000 }),
      'cms.invalid',
    );
    const bad = await editor.as.mutation(api.cms.createPost, {
      ...post,
      slug: 'bad',
      seo: { title: '', description: '' },
    });
    await expectCode(
      editor.as.mutation(api.cmsPublish.schedulePost, { postId: bad, publishAt: Date.now() + 86_400_000 }),
      'cms.blocked',
    );
  });
});

describe('what the screen is told', () => {
  it('gives the countdown and what is waiting, so a minute of silence is explained', async () => {
    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });

    const state = await editor.as.query(api.cmsPublish.deployState, {});
    expect(state.pending).toMatchObject({ deployAt: Date.now() + 60_000 });
    expect(state.pending!.changes[0]).toMatchObject({ label: 'Glossup', action: 'published' });
    expect(state.recent[0]).toMatchObject({ status: 'pending', requestedByName: 'Ife Okon' });
  });

  it('can be told to wait a different length of time', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'tobi@unbuilt.studio', name: 'Tobi' });
    expect(await admin.as.mutation(api.cmsPublish.setDeployBatchSeconds, { seconds: 15 })).toBe(15);

    const workId = await publishableWork();
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    const state = await editor.as.query(api.cmsPublish.deployState, {});
    expect(state.batchSeconds).toBe(15);
    expect(state.pending!.deployAt).toBe(Date.now() + 15_000);
  });

  it('refuses a window that would deploy on every keystroke or look broken', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'tobi@unbuilt.studio', name: 'Tobi' });
    expect(await admin.as.mutation(api.cmsPublish.setDeployBatchSeconds, { seconds: 0 })).toBe(5);
    expect(await admin.as.mutation(api.cmsPublish.setDeployBatchSeconds, { seconds: 86_400 })).toBe(900);
  });

  it("keeps the window out of a content editor's hands", async () => {
    await expectCode(editor.as.mutation(api.cmsPublish.setDeployBatchSeconds, { seconds: 5 }), 'auth.forbidden');
  });
});
