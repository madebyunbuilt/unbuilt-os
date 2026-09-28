import { ConvexError } from 'convex/values';
import { internal } from '../_generated/api';
import { type Doc, type Id, type TableNames } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type ClientPrincipal, type TeamPrincipal } from './principals';
import { inProjectScope } from './projects';
import { canSeeTicket } from './sla';

// Files (14-platform.md, Files; 15-security-and-compliance.md). Uploads go to Convex storage through an upload URL that
// a module hands out after its own permission check; recordUpload then validates what was actually stored. Downloads
// never expose storage ids: a permission-checked query signs a URL that expires in minutes, served by /files/download.

const MB = 1024 * 1024;

const IMAGE_TYPES = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'image/svg+xml': ['svg'],
} as const;

const DOCUMENT_TYPES = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/vnd.oasis.opendocument.text': ['odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods'],
  'text/csv': ['csv'],
  'text/plain': ['txt'],
} as const;

const ARCHIVE_TYPES = {
  'application/zip': ['zip'],
  'application/x-zip-compressed': ['zip'],
} as const;

/** Allowed types and size per upload context: deliverables up to 100 MB, everything else 10 MB. */
export const FILE_CONTEXTS = {
  image: { maxBytes: 10 * MB, types: IMAGE_TYPES },
  document: { maxBytes: 10 * MB, types: { ...IMAGE_TYPES, ...DOCUMENT_TYPES } },
  deliverable: { maxBytes: 100 * MB, types: { ...IMAGE_TYPES, ...DOCUMENT_TYPES, ...ARCHIVE_TYPES } },
} as const satisfies Record<string, { maxBytes: number; types: Record<string, readonly string[]> }>;

export type FileContext = keyof typeof FILE_CONTEXTS;

export class FileError extends ConvexError<{ code: `files.${string}`; message: string }> {
  constructor(code: `files.${string}`, message: string) {
    super({ code, message });
  }
}

/** Checks a stored upload against its context. The type and size come from storage, not from the browser. */
export function validateUpload(
  context: FileContext,
  upload: { name: string; contentType: string | undefined; size: number },
): { mimeType: string } {
  const rules = FILE_CONTEXTS[context];
  if (upload.size <= 0) throw new FileError('files.empty', 'The file is empty');
  if (upload.size > rules.maxBytes) {
    throw new FileError('files.tooLarge', `Files here can be at most ${rules.maxBytes / MB} MB`);
  }
  const mimeType = (upload.contentType ?? '').split(';')[0].trim().toLowerCase();
  const extensions = (rules.types as Record<string, readonly string[]>)[mimeType];
  if (!extensions) throw new FileError('files.typeNotAllowed', 'This type of file cannot be uploaded here');

  const extension = upload.name.includes('.') ? upload.name.split('.').pop()!.toLowerCase() : '';
  if (!extensions.includes(extension)) {
    throw new FileError('files.typeMismatch', `A ${mimeType} file must end in .${extensions.join(' or .')}`);
  }
  return { mimeType };
}

/** Keeps the name readable but safe for headers and file systems: no folders, no control or reserved characters. */
export function sanitizeFileName(name: string): string {
  const baseName = name.split(/[\\/]/).pop() ?? '';
  const cleaned = baseName
    .normalize('NFC')
    .replace(/[:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(-200);
  return cleaned || 'file';
}

function base64ToHex(base64: string): string {
  return Array.from(atob(base64), (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

export type FileOwner = { table: TableNames; id: string };

export type UploadResult = { ok: true; fileId: Id<'files'> } | { ok: false; code: string; message: string };

/**
 * Records a finished upload. A file that breaks the context's rules is deleted from storage and reported as a failure
 * rather than thrown: a thrown error would roll the deletion back with the rest of the mutation.
 *
 * `contentType` is what the browser declared. Storage records the upload's Content-Type header when there is one, and
 * the two must agree.
 */
export async function recordUpload(
  ctx: MutationCtx,
  args: {
    storageId: Id<'_storage'>;
    name: string;
    contentType: string;
    context: FileContext;
    owner: FileOwner;
    visibility: 'internal' | 'client';
    clientId?: Id<'clients'>;
    projectId?: string;
    uploadedBy: { kind: 'team' | 'client' | 'system'; id: string };
  },
): Promise<UploadResult> {
  const stored = await ctx.db.system.get('_storage', args.storageId);
  if (!stored)
    return { ok: false, code: 'files.missingUpload', message: 'The upload was not found. Try uploading again.' };

  const alreadyRecorded = await ctx.db
    .query('files')
    .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
    .first();
  if (alreadyRecorded) {
    return { ok: false, code: 'files.alreadyRecorded', message: 'This upload has already been saved' };
  }

  const name = sanitizeFileName(args.name);
  let mimeType: string;
  try {
    const declared = args.contentType.split(';')[0].trim().toLowerCase();
    const recorded = stored.contentType?.split(';')[0].trim().toLowerCase();
    if (recorded && recorded !== declared) {
      throw new FileError('files.typeMismatch', 'The uploaded file is not the type it claims to be');
    }
    ({ mimeType } = validateUpload(args.context, { name, contentType: declared, size: stored.size }));
  } catch (error) {
    await ctx.storage.delete(args.storageId);
    if (error instanceof FileError) return { ok: false, ...error.data };
    throw error;
  }

  const fileId = await ctx.db.insert('files', {
    storageId: args.storageId,
    name,
    mimeType,
    sizeBytes: stored.size,
    sha256: base64ToHex(stored.sha256),
    owner: args.owner,
    clientId: args.clientId,
    projectId: args.projectId,
    visibility: args.visibility,
    uploadedByKind: args.uploadedBy.kind,
    uploadedById: args.uploadedBy.id,
  });
  // Reading the pixel size needs the bytes, which a mutation cannot fetch, so it follows as its own step. An image
  // without dimensions is usable everywhere; only the website's layout is poorer for it, so this never blocks a save.
  if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
    await ctx.scheduler.runAfter(0, internal.files.measureImage, { fileId });
  }
  return { ok: true, fileId };
}

/** Uploads older than this that were never recorded are deleted by the daily cleanup. */
export const ORPHAN_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

/** Removes a file's record and its stored bytes. */
export async function deleteFile(ctx: MutationCtx, fileId: Id<'files'>): Promise<void> {
  const file = await ctx.db.get('files', fileId);
  if (!file) return;
  await ctx.db.delete('files', fileId);
  await ctx.storage.delete(file.storageId);
}

/**
 * Who may read a file, by the table that owns it. Modules add their tables as they land (deliverables follow project
 * scope, tickets follow client scope, and so on). A table that is not listed is readable by nobody.
 */
export type FileAccessRule = {
  team?: (ctx: QueryCtx, principal: TeamPrincipal, file: Doc<'files'>) => boolean | Promise<boolean>;
  portal?: (ctx: QueryCtx, principal: ClientPrincipal, file: Doc<'files'>) => boolean | Promise<boolean>;
};

export const FILE_ACCESS: Partial<Record<TableNames, FileAccessRule>> = {
  // The studio logo appears on documents; every team member may fetch it.
  orgSettings: { team: () => true },
  // Avatars appear across the team app.
  teamMembers: { team: () => true },
  // A document's PDF follows the document: everyone with documents.view, or the project's members. The client reads it
  // in the portal, which the shared rule above already limits to their own client's client-visible files.
  documents: {
    team: async (ctx, principal, file) => {
      if (principal.permissions.has('documents.view')) return true;
      if (!principal.permissions.has('documents.view.assigned')) return false;
      const projectId = file.projectId ? ctx.db.normalizeId('projects', file.projectId) : null;
      return projectId ? await inProjectScope(ctx, principal, projectId) : false;
    },
    portal: () => true,
  },
  // Drawn signatures are evidence, seen only by those who may read every document (the certificate carries them to the
  // client inside the signed PDF).
  signatureRequests: { team: (_ctx, principal) => principal.permissions.has('documents.view') },
  // An invoice's PDF follows invoices.view; the client reads it in the portal through the shared client-visible rule.
  invoices: { team: (_ctx, principal) => principal.permissions.has('invoices.view'), portal: () => true },
  // Receipts and credit notes are the client's to read, like the invoice; proof of payment and WHT certificates are the
  // team's only.
  receipts: { team: (_ctx, principal) => principal.permissions.has('invoices.view'), portal: () => true },
  creditNotes: { team: (_ctx, principal) => principal.permissions.has('invoices.view'), portal: () => true },
  payments: { team: (_ctx, principal) => principal.permissions.has('invoices.view') },
  whtCredits: { team: (_ctx, principal) => principal.permissions.has('invoices.view') },
  statements: { team: (_ctx, principal) => principal.permissions.has('invoices.view'), portal: () => true },
  // A receipt is the person's own and their approvers': it can carry a home address or a card's last digits, so it is
  // not for every team member, and never for the client even when the expense is billed on to them.
  expenses: {
    team: async (ctx, principal, file) => {
      if (principal.permissions.has('expenses.approve')) return true;
      const expenseId = ctx.db.normalizeId('expenses', file.owner.id);
      const expense = expenseId ? await ctx.db.get('expenses', expenseId) : null;
      return expense?.loggedByMemberId === principal.member._id;
    },
  },
  // A vendor's own invoice, for the people who keep bills and the people who pay them.
  bills: {
    team: (_ctx, principal) => principal.permissions.has('bills.manage') || principal.permissions.has('bills.pay'),
  },
  // Deliverable versions follow project scope for the team. The client reads what was submitted for their review: the
  // shared rule above has already limited that to their own client's client-visible files.
  deliverables: {
    team: async (ctx, principal, file) => {
      const projectId = file.projectId ? ctx.db.normalizeId('projects', file.projectId) : null;
      return projectId ? await inProjectScope(ctx, principal, projectId) : false;
    },
    portal: () => true,
  },
  // A ticket's attachments follow the ticket. For the studio that is the same rule as seeing the ticket at all; for the
  // client, the shared rule above has already limited this to their own client's client-visible files, and the message
  // is checked again here because this is exactly where a mistake would hand a client the studio's private notes.
  ticketMessages: {
    team: async (ctx, principal, file) => {
      const messageId = ctx.db.normalizeId('ticketMessages', file.owner.id);
      const message = messageId ? await ctx.db.get('ticketMessages', messageId) : null;
      const ticket = message ? await ctx.db.get('tickets', message.ticketId) : null;
      return ticket ? await canSeeTicket(ctx, principal, ticket) : false;
    },
    portal: async (ctx, _principal, file) => {
      const messageId = ctx.db.normalizeId('ticketMessages', file.owner.id);
      const message = messageId ? await ctx.db.get('ticketMessages', messageId) : null;
      return message?.visibility === 'public';
    },
  },
};

export async function canReadFile(
  ctx: QueryCtx,
  principal: TeamPrincipal | ClientPrincipal,
  file: Doc<'files'>,
  rules: Partial<Record<TableNames, FileAccessRule>> = FILE_ACCESS,
): Promise<boolean> {
  const rule = rules[file.owner.table as TableNames];
  if (principal.kind === 'team') return (await rule?.team?.(ctx, principal, file)) ?? false;
  // Client users only ever see their own client's files that the studio marked visible to them.
  if (file.visibility !== 'client' || file.clientId !== principal.clientId) return false;
  return (await rule?.portal?.(ctx, principal, file)) ?? false;
}

export const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;
/** Expiries are rounded so a query result can be reused for a minute without handing out a stale link. */
const EXPIRY_ROUNDING_MS = 60 * 1000;

function fileUrlSecret(): string {
  const secret = process.env.FILE_URL_SECRET;
  if (!secret || secret.length < 32) throw new Error('FILE_URL_SECRET must be set to at least 32 characters');
  return secret;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(fileUrlSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** A download link for a file the caller has already been allowed to read. */
export async function signedDownloadUrl(fileId: Id<'files'>, now: number): Promise<{ url: string; expiresAt: number }> {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) throw new Error('CONVEX_SITE_URL is not set');
  const expiresAt = Math.ceil((now + DOWNLOAD_URL_TTL_MS) / EXPIRY_ROUNDING_MS) * EXPIRY_ROUNDING_MS;
  const signature = await sign(`${fileId}.${expiresAt}`);
  const url = new URL('/files/download', siteUrl);
  url.searchParams.set('file', fileId);
  url.searchParams.set('expires', String(expiresAt));
  url.searchParams.set('signature', signature);
  return { url: url.toString(), expiresAt };
}

export async function verifyDownloadSignature(
  params: { file: string | null; expires: string | null; signature: string | null },
  now: number,
): Promise<string | null> {
  const { file, expires, signature } = params;
  if (!file || !expires || !signature || !/^\d+$/.test(expires)) return null;
  if (Number(expires) < now) return null;
  const expected = await sign(`${file}.${expires}`);
  return constantTimeEqual(expected, signature) ? file : null;
}

/** RFC 6266 filename, with an ASCII fallback. */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
