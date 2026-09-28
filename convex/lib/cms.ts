import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';

// The rules every content type shares (13-cms-and-website.md, Editing). The limits are the website's, not preferences:
// a title over 44 characters is cut off in a search result once " | Unbuilt Studio" is appended, and a description
// outside 140 to 160 is either padded by the search engine or truncated by it.

export const SEO_TITLE_MAX = 44;
export const SEO_DESCRIPTION_MIN = 140;
export const SEO_DESCRIPTION_MAX = 160;

/** Images: warn over this, refuse over the hard limit. The warning is the useful one; most photographs land between. */
export const IMAGE_WARN_BYTES = 500 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * How long a publish waits before the deploy hook is called, so a run of publishes becomes one build (13, Publishing).
 *
 * The timer is set by the first publish and is not reset by later ones: later publishes join the batch that is already
 * waiting. Resetting would batch a burst more tightly, but somebody publishing every 50 seconds would never deploy at
 * all, which is the worse failure. The cost is that the website can be a window behind, and the publish row records
 * what went out in each deploy so that is readable afterwards.
 */
export const DEFAULT_DEPLOY_BATCH_SECONDS = 60;

/** Clamped, because this is a setting: a window of 0 would deploy per keystroke and an hour would look broken. */
export function deployBatchMs(seconds: number | undefined): number {
  const value = seconds ?? DEFAULT_DEPLOY_BATCH_SECONDS;
  return Math.min(Math.max(Math.round(value), 5), 15 * 60) * 1000;
}

/** The case study illustrations the website's own code can draw. A new one needs a website change, not a CMS entry. */
export const WORK_ART = ['glossup', 'qravit', 'orrery', 'commit', 'pr'] as const;

export type CmsTable = 'works' | 'servicePages' | 'posts' | 'legalPages' | 'testimonials' | 'siteSettings';

export function cmsError(code: `cms.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** Lowercase words and hyphens. Checked rather than corrected, because a slug is a URL somebody may already have. */
export function assertSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    throw cmsError('cms.slug', 'A slug is lowercase words and numbers separated by single hyphens');
  }
  return trimmed;
}

/** A slug from a title: lowercase words joined by hyphens, and nothing else. Accents are stripped, not transliterated. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Two published pages cannot share a slug, and neither can two drafts: a draft with a taken slug is a page that cannot
 * be published, and finding that out at publish time is finding out too late.
 */
export async function assertSlugFree(
  ctx: QueryCtx,
  table: 'works' | 'servicePages' | 'posts' | 'legalPages',
  slug: string,
  except?: Id<'works'> | Id<'servicePages'> | Id<'posts'> | Id<'legalPages'>,
): Promise<void> {
  const clash = await ctx.db
    .query(table)
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .collect();
  if (clash.some((row) => row._id !== except)) {
    throw cmsError('cms.slugTaken', `Something else already uses the slug "${slug}"`);
  }
}

export type SeoProblem = { field: 'title' | 'description' | 'slug' | 'image'; message: string };

/**
 * Everything wrong with an item's SEO, as a list rather than the first failure. A publish button that reports one
 * problem at a time is a publish button somebody presses five times.
 */
export function seoProblems(seo: { title: string; description: string }, slug: string): SeoProblem[] {
  const problems: SeoProblem[] = [];
  const title = seo.title.trim();
  const description = seo.description.trim();

  if (title.length === 0) problems.push({ field: 'title', message: 'An SEO title is needed' });
  else if (title.length > SEO_TITLE_MAX) {
    problems.push({
      field: 'title',
      message: `The SEO title is ${title.length} characters; ${SEO_TITLE_MAX} is the most that fits`,
    });
  }

  if (description.length === 0) problems.push({ field: 'description', message: 'An SEO description is needed' });
  else if (description.length < SEO_DESCRIPTION_MIN || description.length > SEO_DESCRIPTION_MAX) {
    problems.push({
      field: 'description',
      message: `The SEO description is ${description.length} characters; it should be ${SEO_DESCRIPTION_MIN} to ${SEO_DESCRIPTION_MAX}`,
    });
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
    problems.push({ field: 'slug', message: 'The slug should be lowercase words and numbers separated by hyphens' });
  }
  return problems;
}

/** Alt text is required on every image, because a case study shot carries meaning and not everybody can see it. */
export function imageProblems(shots: readonly { alt: string; caption?: string }[]): SeoProblem[] {
  return shots.some((shot) => shot.alt.trim().length === 0)
    ? [{ field: 'image', message: 'Every image needs alt text before this can be published' }]
    : [];
}

/**
 * The snapshot behind "restore this version". Written on every save, before the change, so the history is what the item
 * looked like at each point rather than a list of what it became.
 */
export async function recordRevision(
  ctx: MutationCtx,
  table: CmsTable,
  id: string,
  snapshot: unknown,
  editedBy: Id<'teamMembers'>,
): Promise<void> {
  await ctx.db.insert('contentRevisions', {
    target: { table, id },
    snapshot,
    editedBy,
    editedAt: Date.now(),
  });
}

/** What a revision is made of, and what a restore writes back: the fields a person edits, and nothing else. */
const NOT_EDITABLE = new Set(['_id', '_creationTime', 'published', 'publishedAt', 'draftUpdatedAt', 'status']);

export function editableFields(doc: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(doc).filter(([field]) => !NOT_EDITABLE.has(field)));
}

/** Whether the live website is behind what somebody has been editing. */
export function hasUnpublishedChanges(row: { status: string; draftUpdatedAt: number; publishedAt?: number }): boolean {
  return row.status === 'published' && row.publishedAt !== undefined && row.draftUpdatedAt > row.publishedAt;
}

/** A label for a content row, for the publish log and for notifications: never an id on its own. */
export function labelOf(table: CmsTable, doc: Record<string, unknown>): string {
  if (table === 'siteSettings') return 'Site settings';
  if (table === 'testimonials') return `Quote from ${String(doc.authorName ?? 'somebody')}`;
  return String(doc.name ?? doc.title ?? doc.slug ?? 'Untitled');
}

export type PublishableTable = Exclude<CmsTable, 'siteSettings'>;

/** The tables the site content endpoint reads, in the order the endpoint returns them. */
export const CONTENT_TABLES: readonly PublishableTable[] = [
  'works',
  'servicePages',
  'posts',
  'legalPages',
  'testimonials',
];

export function isCmsTable(value: string): value is CmsTable {
  return value === 'siteSettings' || (CONTENT_TABLES as readonly string[]).includes(value);
}

export type AnyContentDoc = Doc<'works'> | Doc<'servicePages'> | Doc<'posts'> | Doc<'legalPages'> | Doc<'testimonials'>;
