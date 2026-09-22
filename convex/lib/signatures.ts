import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';

// E-signature rules (07-documents-and-esign.md, E-signatures; decisions of 2026-09-22). The code limits and the
// studio countersigning inside the app were chosen by the studio; the consent text is versioned so each signature
// records exactly what the signer agreed to.

export function signatureError(code: `signatures.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** A request stays open this long unless the studio chooses otherwise. */
export const DEFAULT_EXPIRY_DAYS = 14;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** An emailed code works for ten minutes; five wrong tries lock the link until the studio resends it. */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
/** After the code is checked, the signer has this long to sign before being asked for a new one. */
export const SIGNING_WINDOW_MS = 30 * 60 * 1000;

/** Pending signers are reminded 3 and 7 days after they were invited, and once more the day before it expires. */
export const REMINDERS = [
  { key: 'day3', afterInviteMs: 3 * DAY_MS },
  { key: 'day7', afterInviteMs: 7 * DAY_MS },
] as const;
export const FINAL_REMINDER_BEFORE_EXPIRY_MS = DAY_MS;

export const CONSENT_VERSION = 1;
export const CONSENT_TEXT =
  'I agree that my electronic signature is the legal equivalent of my handwritten signature on this document.';

type Signer = Doc<'signatureRequests'>['signers'][number];

/** Hex SHA-256 of a string, for tokens and codes: neither is ever stored as written. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A link token: 32 random bytes, URL-safe. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A six-digit code, drawn without the bias a plain modulo of a random byte would give. */
export function newCode(): string {
  const limit = 4_294_000_000; // the largest multiple of 1,000,000 below 2^32
  for (;;) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    if (value < limit) return String(value % 1_000_000).padStart(6, '0');
  }
}

/** Compares two strings in constant time, so a wrong code takes as long to refuse as a nearly right one. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/**
 * Who is invited next. In parallel order every client is invited at once, and the studio once they have all signed.
 * In sequential order the clients go first and the studio countersigns last, one at a time: the next signer only once
 * everyone before them has signed.
 */
export function signersToInvite(order: Doc<'signatureRequests'>['order'], signers: Signer[]): Signer[] {
  const waiting = signers.filter((signer) => signer.status === 'waiting');
  if (order === 'parallel') {
    // Every client at once; the studio still countersigns last, once all of them have signed.
    const clientsDone = signers.every((signer) => signer.kind !== 'client_contact' || signer.status === 'signed');
    return waiting.filter((signer) => signer.kind === 'client_contact' || clientsDone);
  }
  const outstanding = signers.filter((signer) => signer.status !== 'signed');
  if (outstanding.some((signer) => signer.status === 'invited' || signer.status === 'locked')) return [];
  const next = [...waiting].sort((a, b) => a.order - b.order)[0];
  return next ? [next] : [];
}

/** Every signer has signed. */
export const allSigned = (signers: Signer[]) => signers.every((signer) => signer.status === 'signed');

/** A signer may act on the request only while it is open, and only while their own part is still to do. */
export function assertCanAct(request: Doc<'signatureRequests'>, signer: Signer, now: number) {
  if (request.status !== 'pending') {
    throw signatureError('signatures.closed', `This signing request is ${request.status}`);
  }
  if (now >= request.expiresAt) throw signatureError('signatures.expired', 'This signing link has expired');
  if (signer.status === 'signed') throw signatureError('signatures.alreadySigned', 'You have already signed this');
  if (signer.status === 'declined') throw signatureError('signatures.declined', 'You declined to sign this');
  if (signer.status === 'locked') {
    throw signatureError('signatures.locked', 'Too many wrong codes. Ask the studio to send you a new link.');
  }
  if (signer.status !== 'invited') throw signatureError('signatures.notYet', 'It is not your turn to sign yet');
}

/** A document has a request still being signed. */
export async function hasOpenRequest(ctx: { db: QueryCtx['db'] }, documentId: Id<'documents'>) {
  const requests = await ctx.db
    .query('signatureRequests')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .collect();
  return requests.some((request) => request.status === 'pending');
}

/** Closes a document's pending request, for example when the document is voided. */
export async function closeOpenRequests(
  ctx: { db: MutationCtx['db'] },
  documentId: Id<'documents'>,
  status: 'cancelled' | 'expired',
) {
  const requests = await ctx.db
    .query('signatureRequests')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .collect();
  for (const request of requests.filter((candidate) => candidate.status === 'pending')) {
    await ctx.db.patch('signatureRequests', request._id, { status });
  }
}
