import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { siteContent } from './cms/siteContentSchema';
import { createTeamMember, newTest, type TestConvex } from './test.auth';

// What the website is served (13-cms-and-website.md, Content endpoint). The promises: the token is required, drafts stay
// out unless a valid preview token names one, and the answer is something the website's own schema accepts.

const TOKEN = 'a-website-content-token-of-at-least-32-characters';

const GOOD_SEO = {
  title: 'Glossup: a shop that loads fast',
  description:
    'How Unbuilt Studio rebuilt Glossup as a mobile app and a web platform, and cut the time a page takes to load from four seconds to under one second.',
};

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let editor: Awaited<ReturnType<typeof createTeamMember>>;

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
  shots: [],
  ...overrides,
});

async function publishedWork(overrides: object = {}): Promise<Id<'works'>> {
  const workId = await editor.as.mutation(api.cms.createWork, work(overrides));
  await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: true });
  await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
  return workId;
}

async function ask(options: { token?: string | null; preview?: string } = {}) {
  const url = new URL('https://example.convex.site/public/site-content');
  if (options.preview) url.searchParams.set('preview', options.preview);
  const headers = new Headers();
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  return await t.fetch(`${url.pathname}${url.search}`, { method: 'GET', headers });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
  vi.stubEnv('WEBSITE_CONTENT_TOKEN', TOKEN);
  vi.stubEnv('WEBSITE_DEPLOY_HOOK_URL', 'https://api.vercel.com/v1/integrations/deploy/abc');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
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

describe('who may read it', () => {
  it('refuses a request with no token, and one with the wrong token', async () => {
    expect((await ask({ token: null })).status).toBe(401);
    expect((await ask({ token: 'not-the-token-but-still-long-enough-to-pass' })).status).toBe(401);
  });

  it('answers a request with the token', async () => {
    expect((await ask()).status).toBe(200);
  });

  it('says it is not configured rather than letting anybody in when no token is set', async () => {
    vi.stubEnv('WEBSITE_CONTENT_TOKEN', '');
    expect((await ask({ token: null })).status).toBe(503);
    expect((await ask()).status).toBe(503);
  });

  it('refuses a token that is only a prefix of the real one', async () => {
    expect((await ask({ token: TOKEN.slice(0, 20) })).status).toBe(401);
  });
});

describe('what comes back', () => {
  it('validates against the schema the website uses', async () => {
    await publishedWork();
    const body = await (await ask()).json();
    // The acceptance criterion, checked with the schema itself rather than by reading fields.
    expect(() => siteContent.parse(body)).not.toThrow();
  });

  it('carries published content and leaves drafts out', async () => {
    await publishedWork();
    await editor.as.mutation(api.cms.createWork, work({ slug: 'secret', name: 'Not ready' }));

    const body = siteContent.parse(await (await ask()).json());
    expect(body.works.map((row) => row.slug)).toEqual(['glossup']);
    expect(JSON.stringify(body)).not.toContain('Not ready');
  });

  it('serves what was published, not what has been written since', async () => {
    const workId = await publishedWork();
    await editor.as.mutation(api.cms.updateWork, { workId, ...work({ listLine: 'Edited after publishing' }) });

    const body = siteContent.parse(await (await ask()).json());
    expect(body.works[0].listLine).toBe('A shop that loads fast');
  });

  it('drops something that was unpublished', async () => {
    const workId = await publishedWork();
    await editor.as.mutation(api.cmsPublish.unpublish, { table: 'works', id: workId });
    expect(siteContent.parse(await (await ask()).json()).works).toHaveLength(0);
  });

  it('never carries an id out of the OS', async () => {
    const workId = await publishedWork();
    await editor.as.mutation(api.cms.createTestimonial, {
      quote: 'They shipped it.',
      authorName: 'Ada Eze',
      authorRole: 'Founder',
      workId,
    });
    const [testimonial] = await t.run((ctx) => ctx.db.query('testimonials').collect());
    await t.run((ctx) => ctx.db.patch('testimonials', testimonial._id, { approvedByClientAt: Date.now() }));
    await editor.as.mutation(api.cmsPublish.publish, { table: 'testimonials', id: testimonial._id });

    const body = siteContent.parse(await (await ask()).json());
    // A quote points at its case study by slug, which is what a URL is made of.
    expect(body.testimonials[0]).toMatchObject({ authorName: 'Ada Eze', workSlug: 'glossup' });
    expect(JSON.stringify(body)).not.toContain(workId);
  });

  it('gives an author a name rather than a member id', async () => {
    const postId = await editor.as.mutation(api.cms.createPost, {
      slug: 'why-fast',
      title: 'Why fast matters',
      excerpt: 'Because people leave.',
      body: [{ kind: 'paragraph', text: 'They do.' }],
      tags: ['performance'],
      seo: GOOD_SEO,
    });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'posts', id: postId });
    const body = siteContent.parse(await (await ask()).json());
    expect(body.posts[0].authorName).toBe('Ife Okon');
    expect(JSON.stringify(body)).not.toContain(editor.memberId);
  });

  it('changes its version when the content changes, and not otherwise', async () => {
    await publishedWork();
    const first = siteContent.parse(await (await ask()).json()).version;
    expect(siteContent.parse(await (await ask()).json()).version).toBe(first);

    vi.setSystemTime(Date.parse('2026-10-12T09:05:00Z'));
    await publishedWork({ slug: 'two', name: 'Two', seo: { ...GOOD_SEO, title: 'Two' } });
    expect(siteContent.parse(await (await ask()).json()).version).not.toBe(first);
  });

  it('says the content is wrong rather than answering with a broken site', async () => {
    const workId = await publishedWork();
    // A published copy that the website's schema will not accept, which is what this endpoint exists to catch.
    await t.run((ctx) => ctx.db.patch('works', workId, { published: { slug: 'glossup', name: 42 } as never }));

    const response = await ask();
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('does not match the schema');
  });
});

describe('previewing a draft', () => {
  const tokenFor = async (table: string, id: string) =>
    (await editor.as.mutation(api.siteContent.previewToken, { table, id })).token;

  it('includes the one draft the token names, and no other', async () => {
    const draft = await editor.as.mutation(api.cms.createWork, work({ slug: 'coming', name: 'Coming soon' }));
    await editor.as.mutation(api.cms.createWork, work({ slug: 'other', name: 'Another draft' }));

    const body = siteContent.parse(await (await ask({ preview: await tokenFor('works', draft) })).json());
    expect(body.works.map((row) => row.slug)).toEqual(['coming']);
    expect(JSON.stringify(body)).not.toContain('Another draft');
    expect(body.preview).toEqual({ table: 'works', slug: 'coming' });
  });

  it('shows the draft of something already published, in its place', async () => {
    const workId = await publishedWork();
    await editor.as.mutation(api.cms.updateWork, { workId, ...work({ listLine: 'The new line' }) });

    const live = siteContent.parse(await (await ask()).json());
    expect(live.works[0].listLine).toBe('A shop that loads fast');
    const previewed = siteContent.parse(await (await ask({ preview: await tokenFor('works', workId) })).json());
    expect(previewed.works[0].listLine).toBe('The new line');
  });

  it('ignores a token that has expired', async () => {
    const draft = await editor.as.mutation(api.cms.createWork, work({ slug: 'coming', name: 'Coming soon' }));
    const token = await tokenFor('works', draft);
    vi.setSystemTime(Date.parse('2026-10-12T10:00:01Z'));

    const body = siteContent.parse(await (await ask({ preview: token })).json());
    // Ignored, not refused: a build asking for a preview it cannot have should still get the live site.
    expect(body.works).toHaveLength(0);
    expect(body.preview).toBeUndefined();
  });

  it('ignores a token somebody has tampered with', async () => {
    const draft = await editor.as.mutation(api.cms.createWork, work({ slug: 'coming', name: 'Coming soon' }));
    const token = await tokenFor('works', draft);
    const other = await editor.as.mutation(api.cms.createWork, work({ slug: 'other', name: 'Another draft' }));

    for (const bad of [
      token.replace(/.$/, '0'),
      token.split('.').slice(0, 3).join('.'),
      `works.${other}.${Date.now() + 1000}.${token.split('.')[3]}`,
    ]) {
      const body = siteContent.parse(await (await ask({ preview: bad })).json());
      expect(body.works).toHaveLength(0);
    }
  });

  it('is not something a preview token can be used as the bearer token for', async () => {
    const draft = await editor.as.mutation(api.cms.createWork, work({ slug: 'coming', name: 'Coming soon' }));
    expect((await ask({ token: await tokenFor('works', draft) })).status).toBe(401);
  });

  it('is offered only to somebody who may see the CMS', async () => {
    const draft = await editor.as.mutation(api.cms.createWork, work({ slug: 'coming', name: 'Coming soon' }));
    const outsider = await createTeamMember(t, roles.member, { email: 'segun@unbuilt.studio', name: 'Segun' });
    await expect(outsider.as.mutation(api.siteContent.previewToken, { table: 'works', id: draft })).rejects.toThrow();
  });

  it('is not cached, unlike the published answer', async () => {
    const draft = await editor.as.mutation(api.cms.createWork, work({ slug: 'coming', name: 'Coming soon' }));
    expect((await ask({ preview: await tokenFor('works', draft) })).headers.get('Cache-Control')).toBe(
      'private, no-store',
    );
    expect((await ask()).headers.get('Cache-Control')).toContain('max-age');
  });
});
