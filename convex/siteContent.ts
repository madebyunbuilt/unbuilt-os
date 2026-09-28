import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type QueryCtx } from './_generated/server';
import { type SiteContent, siteContent } from './cms/siteContentSchema';
import { cmsError, editableFields } from './lib/cms';
import { internalQuery, publicHttp, teamMutation } from './lib/functions';

// What the website is served (13-cms-and-website.md, Content endpoint). Read-only, published content only, and behind a
// token shared with the website's build. The website validates the response against convex/cms/siteContentSchema.ts, so
// a build with content it cannot read fails rather than deploying a broken site.

const PREVIEW_TTL_MS = 60 * 60 * 1000;

function contentToken(): string {
  const token = process.env.WEBSITE_CONTENT_TOKEN;
  if (!token || token.length < 32) {
    throw new Error('WEBSITE_CONTENT_TOKEN must be set to at least 32 characters');
  }
  return token;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Preview tokens are signed with a key derived from the website token rather than a secret of their own. One fewer
 * thing to set on a deployment, and the label keeps the two uses apart: a preview token cannot be replayed as the
 * bearer token, and neither can stand in for the other.
 */
async function previewKey(): Promise<string> {
  return await hmac(contentToken(), 'site-content-preview-v1');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** A short-lived link to see one draft on the website's preview deployment. */
export const previewToken = teamMutation('cms.view')({
  args: { table: v.string(), id: v.string() },
  handler: async (ctx, { table, id }): Promise<{ token: string; expiresAt: number }> => {
    const docId = ctx.db.normalizeId(table as 'works', id);
    if (!docId) throw cmsError('cms.notFound', 'That content is not here');
    const expiresAt = Date.now() + PREVIEW_TTL_MS;
    const payload = `${table}.${id}.${expiresAt}`;
    return { token: `${payload}.${await hmac(await previewKey(), payload)}`, expiresAt };
  },
});

async function readPreviewToken(token: string, now: number): Promise<{ table: string; id: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [table, id, expiresAt, signature] = parts;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < now) return null;
  const expected = await hmac(await previewKey(), `${table}.${id}.${expiresAt}`);
  return constantTimeEqual(expected, signature) ? { table, id } : null;
}

// Assembling the content ----------------------------------------------------------------------------------------------

type ImageSource = { fileId?: Id<'files'>; alt: string; caption?: string; frame?: 'phone' | 'desktop' | 'wide' };

/** Resolves a stored file to the URL the website can fetch. An image whose file is gone is left out rather than broken. */
async function image(ctx: QueryCtx, source: ImageSource) {
  if (!source.fileId) return null;
  const file = await ctx.db.get('files', source.fileId);
  if (!file) return null;
  const url = await ctx.storage.getUrl(file.storageId);
  if (!url) return null;
  return {
    url,
    alt: source.alt,
    ...(source.caption ? { caption: source.caption } : {}),
    ...(source.frame ? { frame: source.frame } : {}),
    // Present when the header could be read at upload, so the website can reserve the space before the image loads.
    ...(file.width !== undefined && file.height !== undefined ? { width: file.width, height: file.height } : {}),
  };
}

/** The copy the website reads, or the draft when this is the item being previewed. */
function copyOf(
  doc: Doc<'works' | 'servicePages' | 'posts' | 'legalPages' | 'testimonials'>,
  previewing: boolean,
): Record<string, unknown> {
  // A preview shows the working copy; everything else shows what publishing wrote. `editableFields` is the same
  // definition of "the content" that revisions and publishing use, so the three cannot drift apart.
  return previewing ? editableFields(doc) : ((doc.published ?? {}) as Record<string, unknown>);
}

/**
 * Everything the website gets, in one read. Only published rows, except the one item a preview token names, whose draft
 * is included in its place — so a preview shows the site as it would be if that item were published, and nothing else.
 */
export const forWebsite = internalQuery({
  args: { preview: v.optional(v.object({ table: v.string(), id: v.string() })) },
  handler: async (ctx, { preview }): Promise<SiteContent> => {
    const isPreviewed = (table: string, id: string) => preview?.table === table && preview?.id === id;
    const include = <T extends { _id: string; status: string }>(table: string, rows: T[]) =>
      rows.filter((row) => row.status === 'published' || isPreviewed(table, row._id));

    const works = include('works', await ctx.db.query('works').collect());
    const services = include('servicePages', await ctx.db.query('servicePages').collect());
    const posts = include('posts', await ctx.db.query('posts').collect());
    const legal = include('legalPages', await ctx.db.query('legalPages').collect());
    const testimonials = include('testimonials', await ctx.db.query('testimonials').collect());
    const settings = await ctx.db.query('siteSettings').unique();
    if (!settings) throw new Error('Site settings have not been set up on this deployment');

    const workSlugById = new Map(works.map((row) => [row._id, row.slug]));

    const content = {
      works: await Promise.all(
        works
          .sort((a, b) => a.order - b.order)
          .map(async (row) => {
            const copy = copyOf(row, isPreviewed('works', row._id)) as Record<string, unknown>;
            const shots = (copy.shots ?? []) as ImageSource[];
            return {
              ...(copy as object),
              slug: row.slug,
              order: row.order,
              publishedAt: row.publishedAt,
              shots: (await Promise.all(shots.map((shot) => image(ctx, shot)))).filter((shot) => shot !== null),
            };
          }),
      ),
      services: services
        .sort((a, b) => a.order - b.order)
        .map((row) => ({
          ...(copyOf(row, isPreviewed('servicePages', row._id)) as object),
          slug: row.slug,
          order: row.order,
        })),
      posts: await Promise.all(
        posts
          .sort((a, b) => (b.publishedAt ?? b.draftUpdatedAt) - (a.publishedAt ?? a.draftUpdatedAt))
          .map(async (row) => {
            const copy = copyOf(row, isPreviewed('posts', row._id)) as Record<string, unknown>;
            const coverFileId = copy.coverFileId as Id<'files'> | undefined;
            const cover = coverFileId ? await image(ctx, { fileId: coverFileId, alt: String(copy.title ?? '') }) : null;
            const author = await ctx.db.get('teamMembers', copy.authorMemberId as Id<'teamMembers'>);
            return {
              ...(copy as object),
              slug: row.slug,
              publishedAt: row.publishedAt,
              // A name, never a member id: what leaves here is what a reader may see.
              authorName: author?.name ?? 'Unbuilt Studio',
              ...(cover ? { cover } : {}),
            };
          }),
      ),
      legal: legal.map((row) => ({
        ...(copyOf(row, isPreviewed('legalPages', row._id)) as object),
        slug: row.slug,
      })),
      testimonials: testimonials.map((row) => {
        const copy = copyOf(row, isPreviewed('testimonials', row._id)) as Record<string, unknown>;
        const workId = copy.workId as Id<'works'> | undefined;
        const workSlug = workId ? workSlugById.get(workId) : undefined;
        return {
          quote: String(copy.quote ?? ''),
          authorName: String(copy.authorName ?? ''),
          authorRole: String(copy.authorRole ?? ''),
          ...(workSlug ? { workSlug } : {}),
        };
      }),
      settings: {
        name: settings.name,
        url: settings.url,
        email: settings.email,
        phone: settings.phone,
        socials: settings.socials,
        timeZone: settings.timeZone,
        statusText: settings.statusText,
        seoDefaults: settings.seoDefaults,
      },
      version: '',
      ...(preview ? { preview: { table: preview.table, slug: '' } } : {}),
    };

    // The version is over the content itself, so it changes when the content does and not when a timestamp moves.
    const version = await sha256(JSON.stringify({ ...content, version: undefined, preview: undefined }));
    const previewedSlug = preview
      ? ([...works, ...services, ...posts, ...legal].find((row) => row._id === preview.id) as { slug?: string })?.slug
      : undefined;

    return siteContent.parse({
      ...content,
      version,
      ...(preview ? { preview: { table: preview.table, slug: previewedSlug ?? '' } } : {}),
    });
  },
});

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * `GET /public/site-content`. The website's build fetches this once and caches it for the build.
 *
 * A wrong or missing bearer token is answered the same way whatever the reason, and a preview token that does not check
 * out is ignored rather than refused: a build asking for a preview it cannot have should still get the live site.
 */
export const siteContentEndpoint = publicHttp(async (ctx, request) => {
  const expected = process.env.WEBSITE_CONTENT_TOKEN;
  if (!expected || expected.length < 32) {
    return new Response('The content endpoint is not configured on this deployment', { status: 503 });
  }
  const offered = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!constantTimeEqual(offered, expected)) return new Response('Unauthorized', { status: 401 });

  const token = new URL(request.url).searchParams.get('preview');
  const preview = token ? await readPreviewToken(token, Date.now()) : null;

  let content: SiteContent;
  try {
    content = await ctx.runQuery(internal.siteContent.forWebsite, { preview: preview ?? undefined });
  } catch (caught) {
    // The caller is the website's own build, holding the shared token, so it is told what is actually wrong. A build
    // that fails saying "content does not match the schema" is one somebody can fix; a bare 500 is one they cannot.
    return new Response(
      `The published content does not match the schema the website expects: ${
        caught instanceof Error ? caught.message : 'unknown reason'
      }`,
      { status: 500 },
    );
  }
  return new Response(JSON.stringify(content), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // A preview is one person looking at one draft; the published answer is the same for every build that asks.
      'Cache-Control': preview ? 'private, no-store' : 'public, max-age=60',
    },
  });
});
