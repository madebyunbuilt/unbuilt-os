import { type ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Turning a finished project into a draft case study (13-cms-and-website.md, From project to case study). What matters
// is the split: the OS fills in what it already knows, and leaves empty what only a writer can supply.

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let editor: Awaited<ReturnType<typeof createTeamMember>>;
let clientId: Id<'clients'>;
let projectId: Id<'projects'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  editor = await createTeamMember(t, roles.content_editor, { email: 'ife@unbuilt.studio', name: 'Ife Okon' });
  const ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  clientId = ada.clientId;
  projectId = await pm.as.mutation(api.projects.create, {
    clientId,
    name: 'Glossup shop',
    type: 'mobile_app',
    billingModel: 'fixed',
    currency: 'NGN',
    startDate: '2026-01-04',
  });
});

afterEach(() => vi.useRealTimers());

const draft = async () => await editor.as.mutation(api.caseStudy.draftFromProject, { projectId });

describe('what it fills in', () => {
  it('takes the client, the year and the type from the project', async () => {
    await t.run((ctx) => ctx.db.patch('projects', projectId, { completedAt: Date.parse('2026-09-30T00:00:00Z') }));
    const { workId, created } = await draft();
    expect(created).toBe(true);

    const work = (await t.run((ctx) => ctx.db.get('works', workId)))!;
    expect(work).toMatchObject({
      name: 'Glossup shop',
      slug: 'glossup-shop',
      listDetail: 'Mobile app',
      status: 'draft',
      projectId,
    });
    expect(work.meta).toMatchObject({ client: 'Glossup', year: '2026', status: 'Delivered' });
  });

  it('names who worked on it, without repeating a role', async () => {
    const dev = await createTeamMember(t, roles.member, { email: 'segun@unbuilt.studio', name: 'Segun' });
    const other = await createTeamMember(t, roles.member, { email: 'chidi@unbuilt.studio', name: 'Chidi' });
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dev.memberId });
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: other.memberId });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('projectMembers').collect();
      for (const row of rows) await ctx.db.patch('projectMembers', row._id, { projectRole: 'Engineering' });
    });

    const { workId } = await draft();
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.meta.role).toBe('Engineering');
  });

  it('links the live site when the project has one', async () => {
    await t.run((ctx) =>
      ctx.db.patch('projects', projectId, {
        links: { production: 'https://glossup.com', repo: undefined, staging: undefined, design: undefined },
      }),
    );
    const { workId } = await draft();
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.link).toEqual({
      href: 'https://glossup.com',
      label: 'Visit the site',
    });
  });
});

describe('what it leaves empty, and why', () => {
  it('leaves the writing and the SEO to a person', async () => {
    const { workId } = await draft();
    const work = (await t.run((ctx) => ctx.db.get('works', workId)))!;
    expect(work.listLine).toBe('');
    expect(work.seo).toEqual({ title: '', description: '' });
    expect(work.brief).toEqual([]);
    expect(work.hardPart).toEqual([]);
    // Artwork is one of a fixed set the website can draw, so it is left for somebody to choose rather than guessed.
    expect(work.art).toBe('');
  });

  it('cannot be published until all of that is filled in', async () => {
    const { workId } = await draft();
    const blockers = (await editor.as.query(api.cms.get, { table: 'works', id: workId }))!.blockers.map(
      (problem) => problem.message,
    );
    expect(blockers.some((message) => message.includes('SEO title'))).toBe(true);
    expect(blockers.some((message) => message.includes('artwork'))).toBe(true);
    expect(blockers.some((message) => message.includes('permission'))).toBe(true);

    const error = await editor.as.mutation(api.cmsPublish.publish, { table: 'works', id: workId }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as ConvexError<{ code: string }>).data.code).toBe('cms.blocked');
  });
});

describe('the screenshots', () => {
  const approvedDeliverableWith = async (mimeType: string) => {
    const fileId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['bytes'], { type: mimeType }));
      return await ctx.db.insert('files', {
        storageId: storageId as Id<'_storage'>,
        name: 'shot.png',
        mimeType,
        sizeBytes: 5,
        sha256: 'abc',
        owner: { table: 'deliverables', id: 'd' },
        visibility: 'internal',
        uploadedByKind: 'team',
        uploadedById: pm.memberId,
      });
    });
    await t.run(async (ctx) => {
      const deliverableId = await ctx.db.insert('deliverables', {
        projectId,
        title: 'The app',
        status: 'approved',
        currentVersion: 2,
        approvedVersion: 1,
      });
      // Two versions: the one the client approved, and a later one that was never approved.
      await ctx.db.insert('deliverableVersions', {
        deliverableId,
        projectId,
        version: 1,
        fileIds: [fileId],
        links: [],
        submittedByMemberId: pm.memberId,
        submittedAt: Date.now(),
      });
      await ctx.db.insert('deliverableVersions', {
        deliverableId,
        projectId,
        version: 2,
        fileIds: [],
        links: [],
        submittedByMemberId: pm.memberId,
        submittedAt: Date.now(),
      });
    });
    return fileId;
  };

  it('takes the version the client approved, not whatever was uploaded last', async () => {
    const fileId = await approvedDeliverableWith('image/png');
    const { workId } = await draft();
    const work = (await t.run((ctx) => ctx.db.get('works', workId)))!;
    expect(work.shots).toHaveLength(1);
    expect(work.shots[0]).toMatchObject({ fileId, caption: 'The app', frame: 'desktop' });
  });

  it('leaves alt text empty, which is what stops it being published', async () => {
    await approvedDeliverableWith('image/png');
    const { workId } = await draft();
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.shots[0].alt).toBe('');
    const blockers = (await editor.as.query(api.cms.get, { table: 'works', id: workId }))!.blockers;
    expect(blockers.some((problem) => problem.message.includes('alt text'))).toBe(true);
  });

  it('takes images only, and not a delivered archive', async () => {
    await approvedDeliverableWith('application/zip');
    const { workId } = await draft();
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.shots).toEqual([]);
  });
});

describe('the scope', () => {
  const sowWith = async (blocks: object[], status: 'draft' | 'sent') => {
    await t.run((ctx) =>
      ctx.db.insert('documents', {
        type: 'sow',
        title: 'Scope of work',
        clientId,
        projectId,
        status,
        blocks: blocks as never,
        currentVersion: 1,
        viewCount: 0,
        createdByMemberId: pm.memberId,
      } as never),
    );
  };

  it('takes the summary from what the SOW says the scope is', async () => {
    await sowWith(
      [
        { kind: 'paragraph', text: 'This agreement is between the parties.' },
        { kind: 'heading', text: 'Scope' },
        { kind: 'paragraph', text: 'A shop the client can run themselves.' },
      ],
      'sent',
    );
    const { workId } = await draft();
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.summary).toBe('A shop the client can run themselves.');
  });

  it('ignores a SOW that was never sent, because a draft is not what was agreed', async () => {
    await sowWith(
      [
        { kind: 'heading', text: 'Scope' },
        { kind: 'paragraph', text: 'Still being written.' },
      ],
      'draft',
    );
    const { workId } = await draft();
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.summary).toBe('');
  });
});

describe('drafting it twice', () => {
  it('hands back the one that exists rather than making another', async () => {
    const first = await draft();
    const second = await draft();
    expect(second).toEqual({ workId: first.workId, created: false });
    expect(await t.run((ctx) => ctx.db.query('works').collect())).toHaveLength(1);
  });

  it('is the same when handover completes, since that is what calls it', async () => {
    const byHand = await draft();
    const onHandover = await t.mutation(internal.caseStudy.draftOnHandover, { projectId });
    expect(onHandover).toEqual({ workId: byHand.workId, created: false });
  });

  it('gives a second project of the same name its own slug', async () => {
    await draft();
    const second = await pm.as.mutation(api.projects.create, {
      clientId,
      name: 'Glossup shop',
      type: 'mobile_app',
      billingModel: 'fixed',
      currency: 'NGN',
      startDate: '2026-06-01',
    });
    const { workId } = await editor.as.mutation(api.caseStudy.draftFromProject, { projectId: second });
    expect((await t.run((ctx) => ctx.db.get('works', workId)))!.slug).toBe('glossup-shop-2');
  });
});

describe('who may draft one', () => {
  it('refuses somebody who cannot write the website', async () => {
    const outsider = await createTeamMember(t, roles.finance, { email: 'zainab@unbuilt.studio', name: 'Zainab' });
    await expect(outsider.as.mutation(api.caseStudy.draftFromProject, { projectId })).rejects.toThrow();
  });
});

describe('finding the one a project already has', () => {
  it('carries the project on the list, so a project can link to its case study', async () => {
    const { workId } = await draft();
    const [row] = await editor.as.query(api.cms.list, { table: 'works' });
    expect(row).toMatchObject({ id: workId, projectId });
  });
});
