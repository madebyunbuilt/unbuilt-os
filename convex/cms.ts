import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import {
  assertSlug,
  assertSlugFree,
  type CmsTable,
  cmsError,
  CONTENT_TABLES,
  editableFields,
  hasUnpublishedChanges,
  imageProblems,
  labelOf,
  type PublishableTable,
  recordRevision,
  seoProblems,
  type SeoProblem,
  unpublishInPlace,
  WORK_ART,
} from './lib/cms';
import { internalQuery, teamMutation, teamQuery } from './lib/functions';
import { type TeamPrincipal } from './lib/principals';

// Writing the website (13-cms-and-website.md). Everything here edits a draft: the copy the website is served is written
// only by publishing, in convex/cmsPublish.ts. So a live page can be edited freely, and nothing reaches the public site
// until somebody with cms.publish says so.

const seo = v.object({ title: v.string(), description: v.string() });
const shot = v.object({
  fileId: v.optional(v.id('files')),
  alt: v.string(),
  caption: v.string(),
  frame: v.union(v.literal('phone'), v.literal('desktop'), v.literal('wide')),
});

/** Every draft write goes through here: one revision per save, one timestamp, and no way to forget either. */
async function saveDraft<T extends PublishableTable>(
  ctx: MutationCtx & { principal: TeamPrincipal },
  table: T,
  id: Id<T>,
  changes: Record<string, unknown>,
): Promise<null> {
  const before = await ctx.db.get(table, id);
  if (!before) throw cmsError('cms.notFound', 'That content is not here');
  await recordRevision(ctx, table, id, editableFields(before), ctx.principal.member._id);
  await ctx.db.patch(table, id, { ...changes, draftUpdatedAt: Date.now() } as never);
  return null;
}

// Works ---------------------------------------------------------------------------------------------------------------

const workFields = {
  name: v.string(),
  art: v.string(),
  listLine: v.string(),
  listDetail: v.string(),
  seo,
  summary: v.string(),
  meta: v.object({ client: v.string(), year: v.string(), role: v.string(), status: v.string() }),
  stack: v.array(v.string()),
  link: v.optional(v.object({ href: v.string(), label: v.string() })),
  brief: v.array(v.string()),
  hardPart: v.array(v.string()),
  built: v.array(v.string()),
  results: v.optional(v.array(v.string())),
  shots: v.array(shot),
};

function assertArt(art: string): string {
  if (!(WORK_ART as readonly string[]).includes(art)) {
    throw cmsError('cms.art', `The website can only draw ${WORK_ART.join(', ')}. Adding one needs a website change.`);
  }
  return art;
}

export const createWork = teamMutation('cms.edit')({
  args: { slug: v.string(), projectId: v.optional(v.id('projects')), ...workFields },
  handler: async (ctx, args): Promise<Id<'works'>> => {
    const slug = assertSlug(args.slug);
    await assertSlugFree(ctx, 'works', slug);
    const order = (await ctx.db.query('works').collect()).length;
    return await ctx.db.insert('works', {
      ...args,
      slug,
      art: assertArt(args.art),
      order,
      status: 'draft',
      draftUpdatedAt: Date.now(),
    });
  },
});

export const updateWork = teamMutation('cms.edit')({
  args: { workId: v.id('works'), slug: v.string(), ...workFields },
  handler: async (ctx, { workId, ...changes }): Promise<null> => {
    const slug = assertSlug(changes.slug);
    await assertSlugFree(ctx, 'works', slug, workId);
    return await saveDraft(ctx, 'works', workId, { ...changes, slug, art: assertArt(changes.art) });
  },
});

/**
 * The client's permission to tell their story publicly, recorded rather than assumed. Publishing is blocked without it,
 * so this is the gate a case study passes before it can go out.
 */
export const recordClientPermission = teamMutation('cms.edit')({
  args: {
    workId: v.id('works'),
    contactId: v.optional(v.id('contacts')),
    note: v.optional(v.string()),
    granted: v.boolean(),
  },
  handler: async (ctx, { workId, contactId, note, granted }): Promise<{ cameDown: boolean }> => {
    const work = await ctx.db.get('works', workId);
    if (!work) throw cmsError('cms.notFound', 'That content is not here');
    await saveDraft(ctx, 'works', workId, {
      clientPermission: granted ? { grantedAt: Date.now(), contactId, note } : undefined,
    });
    // Permission withdrawn is permission withdrawn: a published case study comes off the website rather than staying
    // up while the record says the client has not agreed to it.
    const cameDown = granted
      ? false
      : await unpublishInPlace(ctx, 'works', workId, work, ctx.principal.member._id, labelOf('works', work));
    return { cameDown };
  },
});

// Service pages -------------------------------------------------------------------------------------------------------

const servicePageFields = {
  name: v.string(),
  short: v.string(),
  long: v.string(),
  stack: v.array(v.string()),
  deliverables: v.array(v.string()),
  seo,
  body: v.array(v.any()),
};

export const createServicePage = teamMutation('cms.edit')({
  args: { slug: v.string(), ...servicePageFields },
  handler: async (ctx, args): Promise<Id<'servicePages'>> => {
    const slug = assertSlug(args.slug);
    await assertSlugFree(ctx, 'servicePages', slug);
    const order = (await ctx.db.query('servicePages').collect()).length;
    return await ctx.db.insert('servicePages', {
      ...args,
      slug,
      order,
      status: 'draft',
      draftUpdatedAt: Date.now(),
    });
  },
});

export const updateServicePage = teamMutation('cms.edit')({
  args: { servicePageId: v.id('servicePages'), slug: v.string(), ...servicePageFields },
  handler: async (ctx, { servicePageId, ...changes }): Promise<null> => {
    const slug = assertSlug(changes.slug);
    await assertSlugFree(ctx, 'servicePages', slug, servicePageId);
    return await saveDraft(ctx, 'servicePages', servicePageId, { ...changes, slug });
  },
});

// Insights ------------------------------------------------------------------------------------------------------------

const postFields = {
  title: v.string(),
  excerpt: v.string(),
  body: v.array(v.any()),
  coverFileId: v.optional(v.id('files')),
  tags: v.array(v.string()),
  seo,
};

export const createPost = teamMutation('cms.edit')({
  args: { slug: v.string(), ...postFields },
  handler: async (ctx, args): Promise<Id<'posts'>> => {
    const slug = assertSlug(args.slug);
    await assertSlugFree(ctx, 'posts', slug);
    return await ctx.db.insert('posts', {
      ...args,
      slug,
      // Whoever wrote it, unless somebody later says otherwise: a post without an author has nobody to ask about it.
      authorMemberId: ctx.principal.member._id,
      status: 'draft',
      draftUpdatedAt: Date.now(),
    });
  },
});

export const updatePost = teamMutation('cms.edit')({
  args: { postId: v.id('posts'), slug: v.string(), authorMemberId: v.id('teamMembers'), ...postFields },
  handler: async (ctx, { postId, ...changes }): Promise<null> => {
    const slug = assertSlug(changes.slug);
    await assertSlugFree(ctx, 'posts', slug, postId);
    return await saveDraft(ctx, 'posts', postId, { ...changes, slug });
  },
});

// Legal pages ---------------------------------------------------------------------------------------------------------

const legalPageFields = {
  title: v.string(),
  intro: v.string(),
  sheet: v.string(),
  updatedDate: v.string(),
  sections: v.array(
    v.object({ heading: v.string(), body: v.array(v.string()), list: v.optional(v.array(v.string())) }),
  ),
};

export const createLegalPage = teamMutation('cms.edit')({
  args: { slug: v.string(), ...legalPageFields },
  handler: async (ctx, args): Promise<Id<'legalPages'>> => {
    const slug = assertSlug(args.slug);
    await assertSlugFree(ctx, 'legalPages', slug);
    return await ctx.db.insert('legalPages', { ...args, slug, status: 'draft', draftUpdatedAt: Date.now() });
  },
});

export const updateLegalPage = teamMutation('cms.edit')({
  args: { legalPageId: v.id('legalPages'), slug: v.string(), ...legalPageFields },
  handler: async (ctx, { legalPageId, ...changes }): Promise<null> => {
    const slug = assertSlug(changes.slug);
    await assertSlugFree(ctx, 'legalPages', slug, legalPageId);
    return await saveDraft(ctx, 'legalPages', legalPageId, { ...changes, slug });
  },
});

// Testimonials --------------------------------------------------------------------------------------------------------

const testimonialFields = {
  quote: v.string(),
  authorName: v.string(),
  authorRole: v.string(),
  clientId: v.optional(v.id('clients')),
  workId: v.optional(v.id('works')),
};

export const createTestimonial = teamMutation('cms.edit')({
  args: testimonialFields,
  handler: async (ctx, args): Promise<Id<'testimonials'>> => {
    return await ctx.db.insert('testimonials', { ...args, status: 'draft', draftUpdatedAt: Date.now() });
  },
});

export const updateTestimonial = teamMutation('cms.edit')({
  args: { testimonialId: v.id('testimonials'), approved: v.optional(v.boolean()), ...testimonialFields },
  handler: async (ctx, { testimonialId, approved, ...changes }): Promise<{ cameDown: boolean }> => {
    const testimonial = await ctx.db.get('testimonials', testimonialId);
    if (!testimonial) throw cmsError('cms.notFound', 'That content is not here');
    await saveDraft(ctx, 'testimonials', testimonialId, {
      ...changes,
      // Somebody's words on the public website: the client's approval is recorded, and publishing checks for it.
      ...(approved === undefined ? {} : { approvedByClientAt: approved ? Date.now() : undefined }),
    });
    // Taking approval back takes the quote off the website. Leaving it up would mean the client has said no and the
    // site still says yes, with nothing on screen admitting it.
    const cameDown =
      approved === false
        ? await unpublishInPlace(
            ctx,
            'testimonials',
            testimonialId,
            testimonial,
            ctx.principal.member._id,
            labelOf('testimonials', testimonial),
          )
        : false;
    return { cameDown };
  },
});

// Site settings -------------------------------------------------------------------------------------------------------

export const settings = teamQuery('cms.view')({
  args: {},
  handler: async (ctx) => await ctx.db.query('siteSettings').unique(),
});

export const updateSettings = teamMutation('cms.settings.manage')({
  args: {
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    socials: v.optional(v.array(v.object({ name: v.string(), handle: v.string(), href: v.string() }))),
    timeZone: v.optional(v.string()),
    statusText: v.optional(v.string()),
    seoDefaults: v.optional(seo),
  },
  handler: async (ctx, changes): Promise<null> => {
    const row = await ctx.db.query('siteSettings').unique();
    if (!row) throw cmsError('cms.notFound', 'Site settings have not been set up on this deployment');
    await recordRevision(ctx, 'siteSettings', row._id, editableFields(row), ctx.principal.member._id);
    await ctx.db.patch('siteSettings', row._id, { ...changes, draftUpdatedAt: Date.now() });
    return null;
  },
});

// Reading -------------------------------------------------------------------------------------------------------------

/** What every list needs to show a row honestly: whether it is live, and whether the live copy is behind the draft. */
function rowView(table: CmsTable, doc: Doc<'works' | 'servicePages' | 'posts' | 'legalPages' | 'testimonials'>) {
  return {
    id: doc._id,
    table,
    label: labelOf(table, doc),
    slug: 'slug' in doc ? doc.slug : undefined,
    // Lets a project say whether it already has a case study, rather than drafting a second one to find out.
    projectId: 'projectId' in doc ? doc.projectId : undefined,
    status: doc.status,
    publishedAt: doc.publishedAt,
    draftUpdatedAt: doc.draftUpdatedAt,
    unpublishedChanges: hasUnpublishedChanges(doc),
  };
}

export const list = teamQuery('cms.view')({
  args: { table: v.union(...CONTENT_TABLES.map((name) => v.literal(name))) },
  handler: async (ctx, { table }) => {
    const rows = await ctx.db.query(table).collect();
    return rows
      .sort((a, b) => ('order' in a && 'order' in b ? a.order - b.order : b.draftUpdatedAt - a.draftUpdatedAt))
      .map((row) => rowView(table, row));
  },
});

/**
 * Testimonials, in full. Every other type has a page of its own, so its list only needs a label; a quote is short
 * enough that the list is the whole screen, and a list of "Quote from John Doe" says nothing about the quote.
 */
export const testimonials = teamQuery('cms.view')({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('testimonials').collect();
    return await Promise.all(
      rows
        .sort((a, b) => b.draftUpdatedAt - a.draftUpdatedAt)
        .map(async (row) => ({
          id: row._id,
          quote: row.quote,
          authorName: row.authorName,
          authorRole: row.authorRole,
          status: row.status,
          approvedByClientAt: row.approvedByClientAt,
          unpublishedChanges: hasUnpublishedChanges(row),
          clientName: row.clientId ? ((await ctx.db.get('clients', row.clientId))?.displayName ?? null) : null,
          workName: row.workId ? ((await ctx.db.get('works', row.workId))?.name ?? null) : null,
          workId: row.workId,
          clientId: row.clientId,
          blockers: publishBlockers('testimonials', row),
        })),
    );
  },
});

/** One item's draft, with everything the editor needs to know before it can be published. */
export const get = teamQuery('cms.view')({
  args: { table: v.union(...CONTENT_TABLES.map((name) => v.literal(name))), id: v.string() },
  handler: async (ctx, { table, id }) => {
    const docId = ctx.db.normalizeId(table, id);
    const doc = docId ? await ctx.db.get(table, docId) : null;
    if (!doc) return null;
    const revisions = await ctx.db
      .query('contentRevisions')
      .withIndex('by_target', (q) => q.eq('target.table', table).eq('target.id', id))
      .order('desc')
      .take(20);
    return {
      ...doc,
      unpublishedChanges: hasUnpublishedChanges(doc),
      blockers: publishBlockers(table, doc),
      revisions: await Promise.all(
        revisions.map(async (revision) => ({
          id: revision._id,
          editedAt: revision.editedAt,
          editedByName: (await ctx.db.get('teamMembers', revision.editedBy))?.name ?? 'Somebody',
        })),
      ),
    };
  },
});

/**
 * Why this item cannot be published yet, as a list. Read by the editor so the reasons are visible while writing, and by
 * publishing itself, so the screen and the rule can never disagree.
 */
export function publishBlockers(table: PublishableTable, doc: Record<string, unknown>): SeoProblem[] {
  const problems: SeoProblem[] = [];
  if ('seo' in doc && 'slug' in doc) {
    problems.push(...seoProblems(doc.seo as { title: string; description: string }, doc.slug as string));
  }
  if (Array.isArray(doc.shots)) problems.push(...imageProblems(doc.shots as { alt: string }[]));

  if (table === 'works' && !(WORK_ART as readonly string[]).includes(String(doc.art ?? ''))) {
    // Left empty by a draft made from a project, because the website draws a fixed set and guessing one is a guess.
    problems.push({ field: 'image', message: `Choose the artwork for this case study: ${WORK_ART.join(', ')}` });
  }
  if (table === 'works' && doc.clientPermission === undefined) {
    problems.push({
      field: 'image',
      message: 'The client has not given permission to publish this case study yet',
    });
  }
  if (table === 'testimonials' && doc.approvedByClientAt === undefined) {
    problems.push({ field: 'image', message: 'The client has not approved this quote yet' });
  }
  return problems;
}

/** Restoring a revision writes it back as the draft. The published copy is untouched until somebody publishes. */
export const restoreRevision = teamMutation('cms.edit')({
  args: { revisionId: v.id('contentRevisions') },
  handler: async (ctx, { revisionId }): Promise<null> => {
    const revision = await ctx.db.get('contentRevisions', revisionId);
    if (!revision) throw cmsError('cms.notFound', 'That revision is not here');
    const table = revision.target.table as CmsTable;
    const docId = ctx.db.normalizeId(table, revision.target.id);
    if (!docId) throw cmsError('cms.notFound', 'The content this revision belongs to is gone');

    const current = await ctx.db.get(table, docId as never);
    if (!current) throw cmsError('cms.notFound', 'The content this revision belongs to is gone');
    // The restore is itself a save, so what it replaced can be restored in turn.
    await recordRevision(ctx, table, revision.target.id, editableFields(current), ctx.principal.member._id);
    await ctx.db.patch(
      table,
      docId as never,
      {
        ...(revision.snapshot as Record<string, unknown>),
        draftUpdatedAt: Date.now(),
      } as never,
    );
    return null;
  },
});

/** The revisions of one item, for the internal action that needs them without a session. */
export const revisionsFor = internalQuery({
  args: { table: v.string(), id: v.string() },
  handler: async (ctx, { table, id }): Promise<Doc<'contentRevisions'>[]> =>
    await ctx.db
      .query('contentRevisions')
      .withIndex('by_target', (q) => q.eq('target.table', table).eq('target.id', id))
      .order('desc')
      .collect(),
});
