import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { cmsError, slugify } from './lib/cms';
import { internalMutation, teamMutation } from './lib/functions';

// Turning a finished project into a draft case study (13-cms-and-website.md, From project to case study).
//
// What is filled in is what the OS already knows and nobody should retype: the client, the year, who worked on it, the
// scope as the SOW stated it, and the screenshots that were actually delivered. What is left empty is what nobody but a
// writer can supply — the hook, the brief, the hard part, and the SEO. An empty field is an invitation to write;
// a guessed one reads as finished and goes out wrong.

const TYPE_LABELS: Record<string, string> = {
  mobile_app: 'Mobile app',
  web_platform: 'Web platform',
  product_design: 'Product design',
  backend: 'Backend',
  devops: 'DevOps',
  video: 'Video and motion',
  dev_tool: 'Dev tool',
  retainer: 'Retainer',
  other: 'Software',
};

/** The year the work is remembered by: when it finished, or when it was due, or when it started. */
function yearOf(project: Doc<'projects'>): string {
  const finished = project.completedAt ? new Date(project.completedAt).getUTCFullYear() : undefined;
  return String(finished ?? (project.dueDate ?? project.startDate).slice(0, 4));
}

/** A free slug near the project's name, so two projects of the same name do not collide. */
async function freeSlug(ctx: MutationCtx, name: string): Promise<string> {
  const base = slugify(name) || 'case-study';
  for (let attempt = 0; attempt < 50; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await ctx.db
      .query('works')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();
    if (!taken) return slug;
  }
  return `${base}-${Date.now()}`;
}

/**
 * The scope as the SOW stated it. Read from a sent SOW rather than a draft: a draft is what somebody was thinking, and
 * a sent one is what the client agreed to. The heading is looked for first, because a SOW opens with preamble.
 */
function scopeFrom(sow: Doc<'documents'> | null): string {
  if (!sow) return '';
  const blocks = sow.blocks ?? [];
  const scopeAt = blocks.findIndex(
    (block) => block.kind === 'heading' && /scope|what we will build|deliverables/i.test(block.text),
  );
  const after = scopeAt >= 0 ? blocks.slice(scopeAt + 1) : blocks;
  const paragraph = after.find((block) => block.kind === 'paragraph' && block.text.trim().length > 0);
  return paragraph && paragraph.kind === 'paragraph' ? paragraph.text.trim() : '';
}

/**
 * Creates the draft, or hands back the one that already exists. Idempotent on purpose: this is meant to be called when
 * handover completes, and a handover reopened and completed again must not leave two case studies behind.
 */
async function draftFor(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
): Promise<{ workId: Id<'works'>; created: boolean }> {
  const existing = await ctx.db
    .query('works')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .first();
  if (existing) return { workId: existing._id, created: false };

  const project = await ctx.db.get('projects', projectId);
  if (!project) throw cmsError('cms.notFound', 'That project is not here');
  const client = await ctx.db.get('clients', project.clientId);

  const members = await ctx.db
    .query('projectMembers')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .collect();
  const roles = [...new Set(members.map((row) => row.projectRole?.trim()).filter((role): role is string => !!role))];

  const documents = await ctx.db
    .query('documents')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .collect();
  const sow = documents.find((doc) => doc.type === 'sow' && doc.status !== 'draft' && doc.status !== 'void') ?? null;

  // The screenshots that were actually delivered: the latest version of each approved deliverable, images only.
  const deliverables = await ctx.db
    .query('deliverables')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .collect();
  const shots: { fileId: Id<'files'>; alt: string; caption: string; frame: 'phone' | 'desktop' | 'wide' }[] = [];
  for (const deliverable of deliverables.filter((row) => row.status === 'approved')) {
    // The version the client approved, which is the one that was actually delivered — not whatever was uploaded last.
    const version = deliverable.approvedVersion ?? deliverable.currentVersion;
    const final = await ctx.db
      .query('deliverableVersions')
      .withIndex('by_deliverable_version', (q) => q.eq('deliverableId', deliverable._id).eq('version', version))
      .first();
    for (const fileId of final?.fileIds ?? []) {
      const file = await ctx.db.get('files', fileId);
      if (!file?.mimeType.startsWith('image/')) continue;
      // Alt text is left empty deliberately: it is required to publish, and only a person can write it.
      shots.push({ fileId, alt: '', caption: deliverable.title, frame: 'desktop' });
    }
  }

  const workId = await ctx.db.insert('works', {
    slug: await freeSlug(ctx, project.name),
    name: project.name,
    // Left empty: the artwork is one of a fixed set the website can draw, and picking one here would be a guess.
    art: '',
    listLine: '',
    listDetail: TYPE_LABELS[project.type] ?? 'Software',
    seo: { title: '', description: '' },
    summary: scopeFrom(sow),
    meta: {
      client: client?.displayName ?? '',
      year: yearOf(project),
      role: roles.join(', '),
      status: 'Delivered',
    },
    stack: [TYPE_LABELS[project.type] ?? 'Software'],
    ...(project.links.production ? { link: { href: project.links.production, label: 'Visit the site' } } : {}),
    brief: [],
    hardPart: [],
    built: [],
    shots,
    order: (await ctx.db.query('works').collect()).length,
    status: 'draft',
    projectId,
    draftUpdatedAt: Date.now(),
  });
  return { workId, created: true };
}

/** Drafting a case study by hand, from the project's page. */
export const draftFromProject = teamMutation('cms.edit')({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }): Promise<{ workId: Id<'works'>; created: boolean }> =>
    await draftFor(ctx, projectId),
});

/**
 * The same thing when a handover completes, which is the moment the spec names. Internal because the person completing
 * a handover is not necessarily somebody who may write the website, and the draft should appear either way.
 *
 * Handover itself lands in step 15; this is what it calls.
 */
export const draftOnHandover = internalMutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }): Promise<{ workId: Id<'works'>; created: boolean }> =>
    await draftFor(ctx, projectId),
});
