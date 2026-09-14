import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc } from './_generated/dataModel';
import {
  canReadFile,
  contentDisposition,
  ORPHAN_UPLOAD_AGE_MS,
  signedDownloadUrl,
  verifyDownloadSignature,
} from './lib/files';
import { internalMutation, internalQuery, portalQuery, publicHttp, teamQuery } from './lib/functions';
import { authError } from './lib/principals';

// Download links (14-platform.md, Files). Reading a file is decided by FILE_ACCESS in convex/lib/files.ts for the
// table that owns it; a caller who may not read it gets "not found", whatever id they hold.

const notFound = () => authError('auth.notFound', 'File not found');

export const teamDownloadUrl = teamQuery(null)({
  args: { fileId: v.id('files') },
  handler: async (ctx, { fileId }) => {
    const file = await ctx.db.get('files', fileId);
    if (!file || !canReadFile(ctx.principal, file)) throw notFound();
    return { name: file.name, ...(await signedDownloadUrl(fileId, Date.now())) };
  },
});

export const portalDownloadUrl = portalQuery(null)({
  args: { fileId: v.id('files') },
  handler: async (ctx, { fileId }) => {
    const file = await ctx.db.get('files', fileId);
    if (!file || !canReadFile(ctx.principal, file)) throw notFound();
    return { name: file.name, ...(await signedDownloadUrl(fileId, Date.now())) };
  },
});

export const fileForDownload = internalQuery({
  args: { fileId: v.string() },
  handler: async (ctx, { fileId }): Promise<Pick<Doc<'files'>, 'storageId' | 'name' | 'mimeType'> | null> => {
    const id = ctx.db.normalizeId('files', fileId);
    const file = id ? await ctx.db.get('files', id) : null;
    return file ? { storageId: file.storageId, name: file.name, mimeType: file.mimeType } : null;
  },
});

/** GET /files/download?file=…&expires=…&signature=… */
export const download = publicHttp(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const fileId = await verifyDownloadSignature(
    { file: params.get('file'), expires: params.get('expires'), signature: params.get('signature') },
    Date.now(),
  );
  if (!fileId) return new Response('This download link has expired or is not valid', { status: 403 });

  const file = await ctx.runQuery(internal.files.fileForDownload, { fileId });
  const blob = file ? await ctx.storage.get(file.storageId) : null;
  if (!file || !blob) return new Response('File not found', { status: 404 });

  return new Response(blob, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': contentDisposition(file.name),
      'Cache-Control': 'private, no-store',
      // The file is served from the Convex site domain; never let it run as a page.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
});

const CLEANUP_BATCH = 200;

/**
 * Deletes uploads that were never recorded against a record, once they are a day old: someone chose a file and then
 * abandoned the form. Runs daily from convex/crons.ts and reschedules itself while there is more to check.
 */
export const cleanupOrphanUploads = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), minAgeMs: v.optional(v.number()) },
  handler: async (ctx, { cursor, minAgeMs = ORPHAN_UPLOAD_AGE_MS }) => {
    const cutoff = Date.now() - Math.max(0, minAgeMs);
    const page = await ctx.db.system
      .query('_storage')
      .order('asc')
      .paginate({ cursor: cursor ?? null, numItems: CLEANUP_BATCH });

    let deleted = 0;
    let reachedRecentUploads = false;
    for (const upload of page.page) {
      if (upload._creationTime > cutoff) {
        reachedRecentUploads = true;
        break;
      }
      const recorded = await ctx.db
        .query('files')
        .withIndex('by_storage', (q) => q.eq('storageId', upload._id))
        .first();
      if (!recorded) {
        await ctx.storage.delete(upload._id);
        deleted++;
      }
    }

    if (!reachedRecentUploads && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.files.cleanupOrphanUploads, { cursor: page.continueCursor, minAgeMs });
    }
    return { deleted };
  },
});
