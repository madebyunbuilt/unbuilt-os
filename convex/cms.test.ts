import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Writing the website (13-cms-and-website.md). The rules worth holding onto: nothing reaches the public site until it is
// published, the SEO limits are the website's and not suggestions, and a case study is not the studio's story to tell
// alone.

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
  // 147 characters, inside the 140 to 160 the website needs. The first draft of this fixture was 162 and the rule caught
  // it, which is the rule doing its job on the person writing the test.
  description:
    'How Unbuilt Studio rebuilt Glossup as a mobile app and a web platform, and cut the time a page takes to load from four seconds to under one second.',
};

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let editor: Awaited<ReturnType<typeof createTeamMember>>;
let member: Awaited<ReturnType<typeof createTeamMember>>;

const work = (overrides: object = {}) => ({
  slug: 'glossup',
  name: 'Glossup',
  art: 'glossup',
  listLine: 'A shop that loads fast',
  listDetail: 'Mobile app and web platform',
  seo: GOOD_SEO,
  summary: 'A rebuild of the whole shop.',
  meta: { client: 'Glossup', year: '2026', role: 'Design and build', status: 'Live' },
  stack: ['Expo', 'Next.js'],
  brief: ['Make it fast'],
  hardPart: ['Images'],
  built: ['An app'],
  shots: [{ alt: 'The product list', caption: 'Products', frame: 'phone' as const }],
  ...overrides,
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  editor = await createTeamMember(t, roles.content_editor, { email: 'ife@unbuilt.studio', name: 'Ife Okon' });
  member = await createTeamMember(t, roles.member, { email: 'segun@unbuilt.studio', name: 'Segun Cole' });
});

afterEach(() => vi.useRealTimers());

describe('who may write the website', () => {
  it('lets a content editor write, and refuses everybody without cms.edit', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    expect(workId).toBeTruthy();
    await expectCode(member.as.mutation(api.cms.createWork, work({ slug: 'other' })), 'auth.forbidden');
    await expectCode(member.as.query(api.cms.list, { table: 'works' }), 'auth.forbidden');
  });

  it('keeps a client out of the CMS entirely', async () => {
    const ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(ada.as.query(api.cms.list, { table: 'works' }), 'auth.forbidden');
  });

  it('keeps site settings behind its own permission', async () => {
    // A content editor writes pages; the studio's own contact details are somebody else's to change.
    await expectCode(editor.as.mutation(api.cms.updateSettings, { statusText: 'Booked up' }), 'auth.forbidden');
    const admin = await createTeamMember(t, roles.admin, { email: 'tobi@unbuilt.studio', name: 'Tobi' });
    await admin.as.mutation(api.cms.updateSettings, { statusText: 'Booked up' });
    expect((await admin.as.query(api.cms.settings, {}))!.statusText).toBe('Booked up');
  });
});

describe('slugs', () => {
  it('refuses anything that is not lowercase words and hyphens', async () => {
    for (const slug of ['Glossup', 'glossup shop', 'glossup--shop', '-glossup', 'glossup_shop']) {
      await expectCode(editor.as.mutation(api.cms.createWork, work({ slug })), 'cms.slug');
    }
  });

  it('refuses a slug something else already uses, draft or published', async () => {
    await editor.as.mutation(api.cms.createWork, work());
    // Caught while it is still a draft, because finding out at publish time is finding out too late.
    await expectCode(editor.as.mutation(api.cms.createWork, work({ name: 'Another' })), 'cms.slugTaken');
  });

  it('lets an item keep its own slug when it is edited', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    await editor.as.mutation(api.cms.updateWork, { workId, ...work({ listLine: 'Reworded' }) });
    // Read from the row: `get` is one query across every content type, so its result is a union of them.
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.listLine).toBe('Reworded');
  });
});

describe('what stops something being published', () => {
  const blockers = async (workId: Id<'works'>) =>
    (await editor.as.query(api.cms.get, { table: 'works', id: workId }))!.blockers.map((b) => b.message);

  it('names every problem at once, rather than the first one', async () => {
    const workId = await editor.as.mutation(
      api.cms.createWork,
      work({
        seo: { title: 'x'.repeat(50), description: 'too short' },
        shots: [{ alt: '', caption: '', frame: 'wide' }],
      }),
    );
    const said = await blockers(workId);
    expect(said).toHaveLength(4);
    expect(said.some((m) => m.includes('50 characters'))).toBe(true);
    expect(said.some((m) => m.includes('140 to 160'))).toBe(true);
    expect(said.some((m) => m.includes('alt text'))).toBe(true);
    expect(said.some((m) => m.includes('permission'))).toBe(true);
  });

  it('counts a title of exactly 44 characters as fine, and 45 as too long', async () => {
    const at44 = await editor.as.mutation(
      api.cms.createWork,
      work({ slug: 'a', seo: { ...GOOD_SEO, title: 'x'.repeat(44) } }),
    );
    expect(await blockers(at44)).not.toContain('The SEO title is 44 characters; 44 is the most that fits');
    const at45 = await editor.as.mutation(
      api.cms.createWork,
      work({ slug: 'b', seo: { ...GOOD_SEO, title: 'x'.repeat(45) } }),
    );
    expect(await blockers(at45)).toContain('The SEO title is 45 characters; 44 is the most that fits');
  });

  it('holds a case study back until the client has said yes', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    expect(await blockers(workId)).toEqual(['The client has not given permission to publish this case study yet']);

    await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: true, note: 'Said yes on a call' });
    expect(await blockers(workId)).toEqual([]);
    // And it can be taken back, which puts the block back.
    await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: false });
    expect(await blockers(workId)).toHaveLength(1);
  });

  it('holds a quote back until the client has approved it', async () => {
    const id = await editor.as.mutation(api.cms.createTestimonial, {
      quote: 'They shipped it.',
      authorName: 'Ada Eze',
      authorRole: 'Founder',
    });
    const problems = async () =>
      (await editor.as.query(api.cms.get, { table: 'testimonials', id }))!.blockers.map((b) => b.message);
    expect(await problems()).toEqual(['The client has not approved this quote yet']);
    await editor.as.mutation(api.cms.updateTestimonial, {
      testimonialId: id,
      approved: true,
      quote: 'They shipped it.',
      authorName: 'Ada Eze',
      authorRole: 'Founder',
    });
    expect(await problems()).toEqual([]);
  });

  it('refuses artwork the website cannot draw', async () => {
    await expectCode(editor.as.mutation(api.cms.createWork, work({ art: 'something-new' })), 'cms.art');
  });
});

describe('drafts and the live website', () => {
  it('starts as a draft with nothing published', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    const stored = await t.run((ctx) => ctx.db.get('works', workId));
    expect(stored!.status).toBe('draft');
    expect(stored).not.toHaveProperty('published');
    expect(stored).not.toHaveProperty('publishedAt');
  });

  it('leaves the published copy alone when the draft is edited', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    // Standing in for publishing, which is the next piece: the copy the website reads is written only by that.
    await t.run((ctx) =>
      ctx.db.patch('works', workId, {
        status: 'published',
        publishedAt: Date.now(),
        published: { ...work(), listLine: 'What the website says' },
      }),
    );

    vi.setSystemTime(Date.parse('2026-10-12T10:00:00Z'));
    await editor.as.mutation(api.cms.updateWork, { workId, ...work({ listLine: 'A newer line, not live yet' }) });

    const stored = await t.run((ctx) => ctx.db.get('works', workId));
    expect(stored!.listLine).toBe('A newer line, not live yet');
    expect((stored!.published as { listLine: string }).listLine).toBe('What the website says');
    // And the screen can tell: the draft is newer than what went out.
    expect((await editor.as.query(api.cms.get, { table: 'works', id: workId }))!.unpublishedChanges).toBe(true);
  });

  it('says a published item with no later edit has nothing waiting', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    await t.run((ctx) =>
      ctx.db.patch('works', workId, { status: 'published', publishedAt: Date.now() + 1, published: work() }),
    );
    expect((await editor.as.query(api.cms.get, { table: 'works', id: workId }))!.unpublishedChanges).toBe(false);
  });
});

describe('revisions', () => {
  it('keeps one per save, as the item was before it', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    await editor.as.mutation(api.cms.updateWork, { workId, ...work({ listLine: 'Second' }) });
    await editor.as.mutation(api.cms.updateWork, { workId, ...work({ listLine: 'Third' }) });

    const revisions = await t.query(internal.cms.revisionsFor, { table: 'works', id: workId });
    expect(revisions).toHaveLength(2);
    // Newest first, and each holds what the item looked like before that save.
    expect((revisions[0].snapshot as { listLine: string }).listLine).toBe('Second');
    expect((revisions[1].snapshot as { listLine: string }).listLine).toBe('A shop that loads fast');
    expect(revisions[0].editedBy).toBe(editor.memberId);
  });

  it('restores a revision as the draft, without touching what is live', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    await t.run((ctx) =>
      ctx.db.patch('works', workId, {
        status: 'published',
        publishedAt: Date.now(),
        published: { ...work(), listLine: 'The live line' },
      }),
    );
    await editor.as.mutation(api.cms.updateWork, { workId, ...work({ listLine: 'A mistake' }) });

    const [latest] = await t.query(internal.cms.revisionsFor, { table: 'works', id: workId });
    await editor.as.mutation(api.cms.restoreRevision, { revisionId: latest._id });

    const stored = await t.run((ctx) => ctx.db.get('works', workId));
    expect(stored!.listLine).toBe('A shop that loads fast');
    // The acceptance criterion: restoring changes the draft and nothing the public site is served.
    expect((stored!.published as { listLine: string }).listLine).toBe('The live line');
    expect(stored!.status).toBe('published');
  });

  it('keeps the restore itself as a revision, so it can be undone in turn', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    await editor.as.mutation(api.cms.updateWork, { workId, ...work({ listLine: 'A mistake' }) });
    const [before] = await t.query(internal.cms.revisionsFor, { table: 'works', id: workId });
    await editor.as.mutation(api.cms.restoreRevision, { revisionId: before._id });

    const after = await t.query(internal.cms.revisionsFor, { table: 'works', id: workId });
    expect(after).toHaveLength(2);
    expect((after[0].snapshot as { listLine: string }).listLine).toBe('A mistake');
  });

  it('records a revision when the settings row changes', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'tobi@unbuilt.studio', name: 'Tobi' });
    const row = (await admin.as.query(api.cms.settings, {}))!;
    await admin.as.mutation(api.cms.updateSettings, { statusText: 'Booked up' });
    const revisions = await t.query(internal.cms.revisionsFor, { table: 'siteSettings', id: row._id });
    expect(revisions).toHaveLength(1);
    expect((revisions[0].snapshot as { statusText: string }).statusText).toBe('Taking new work');
  });
});

describe('the other content types', () => {
  it('writes a service page, an insight and a legal page as drafts', async () => {
    const servicePageId = await editor.as.mutation(api.cms.createServicePage, {
      slug: 'mobile-apps',
      name: 'Mobile apps',
      short: 'Apps people keep',
      long: 'The long version.',
      stack: ['Expo'],
      deliverables: ['An app'],
      seo: GOOD_SEO,
      body: [{ kind: 'paragraph', text: 'What we do.' }],
    });
    const postId = await editor.as.mutation(api.cms.createPost, {
      slug: 'why-fast',
      title: 'Why fast matters',
      excerpt: 'Because people leave.',
      body: [{ kind: 'paragraph', text: 'They do.' }],
      tags: ['performance'],
      seo: GOOD_SEO,
    });
    const legalPageId = await editor.as.mutation(api.cms.createLegalPage, {
      slug: 'privacy',
      title: 'Privacy notice',
      intro: 'What we keep.',
      sheet: 'Privacy',
      updatedDate: '2026-10-12',
      sections: [{ heading: 'What we collect', body: ['Your name.'] }],
    });

    for (const [table, id] of [
      ['servicePages', servicePageId],
      ['posts', postId],
      ['legalPages', legalPageId],
    ] as const) {
      const row = await editor.as.query(api.cms.get, { table, id });
      expect(row!.status).toBe('draft');
      expect(row).not.toHaveProperty('published');
    }
    // An insight is credited to whoever wrote it, so there is somebody to ask about it.
    expect((await t.run((ctx) => ctx.db.get('posts', postId)))!.authorMemberId).toBe(editor.memberId);
  });

  it('lists each type with what a row needs to be read honestly', async () => {
    await editor.as.mutation(api.cms.createWork, work());
    const [row] = await editor.as.query(api.cms.list, { table: 'works' });
    expect(row).toMatchObject({ label: 'Glossup', slug: 'glossup', status: 'draft', unpublishedChanges: false });
  });
});

describe('taking a permission back', () => {
  it('takes a published case study off the website, rather than leaving it up', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: true });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.status).toBe('published');

    const { cameDown } = await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: false });
    expect(cameDown).toBe(true);

    // The client has said no, so the website must stop saying yes.
    const stored = await t.run((ctx) => ctx.db.get('works', workId));
    expect(stored!.status).toBe('draft');
    expect(stored).not.toHaveProperty('published');
    // And a rebuild is asked for, so it actually leaves the site.
    const [deploy] = await t.run((ctx) => ctx.db.query('publishes').collect());
    expect(deploy.changes.at(-1)).toMatchObject({ action: 'unpublished', table: 'works' });
  });

  it('takes a published quote down when the client withdraws approval', async () => {
    const id = await editor.as.mutation(api.cms.createTestimonial, {
      quote: 'They shipped it.',
      authorName: 'Ada Eze',
      authorRole: 'Founder',
    });
    const fields = { quote: 'They shipped it.', authorName: 'Ada Eze', authorRole: 'Founder' };
    await editor.as.mutation(api.cms.updateTestimonial, { testimonialId: id, approved: true, ...fields });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'testimonials', id });

    const { cameDown } = await editor.as.mutation(api.cms.updateTestimonial, {
      testimonialId: id,
      approved: false,
      ...fields,
    });
    expect(cameDown).toBe(true);
    expect((await t.run((ctx) => ctx.db.get('testimonials', id)))!.status).toBe('draft');
  });

  it('says nothing came down when it was never up', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: true });
    const { cameDown } = await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: false });
    expect(cameDown).toBe(false);
    expect(await t.run((ctx) => ctx.db.query('publishes').collect())).toHaveLength(0);
  });

  it('leaves a published item alone when the permission is being given, not taken', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    await editor.as.mutation(api.cms.recordClientPermission, { workId, granted: true });
    await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId });
    const { cameDown } = await editor.as.mutation(api.cms.recordClientPermission, {
      workId,
      granted: true,
      note: 'Confirmed again in writing',
    });
    expect(cameDown).toBe(false);
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.status).toBe('published');
  });
});

describe('the testimonials list', () => {
  it('carries the quote and who it is about, not just a label', async () => {
    const workId = await editor.as.mutation(api.cms.createWork, work());
    const ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await editor.as.mutation(api.cms.createTestimonial, {
      quote: 'They shipped it.',
      authorName: 'Ada Eze',
      authorRole: 'Founder',
      clientId: ada.clientId,
      workId,
    });
    const [row] = await editor.as.query(api.cms.testimonials, {});
    expect(row).toMatchObject({
      quote: 'They shipped it.',
      authorName: 'Ada Eze',
      authorRole: 'Founder',
      clientName: 'Glossup',
      workName: 'Glossup',
      status: 'draft',
    });
    expect(row.blockers.map((problem) => problem.message)).toContain('The client has not approved this quote yet');
  });
});
