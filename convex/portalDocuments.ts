import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { recordActivity, text } from './lib/crm';
import { documentError, missingVariables } from './lib/documentBlocks';
import { DECIDABLE_STATUSES, TYPE_LABELS, fillBlocks, variableValues } from './lib/documents';
import { portalMutation, portalQuery } from './lib/functions';
import { type ClientPrincipal } from './lib/principals';
import { getOrgSettings } from './lib/settings';
import { localDateString } from './lib/businessTime';

// Documents in the client portal (12-client-portal.md, Documents). The client reads what was sent to them, accepts or
// declines a quote, and signs through the ceremony already built for token links. Nothing a client cannot act on is
// offered, and a draft is never theirs to see.

/** Quotes and proposals are accepted; the rest are signed (07-documents-and-esign.md). */
const ACCEPTED_TYPES: ReadonlySet<Doc<'documents'>['type']> = new Set(['quote', 'proposal']);

/** A client never sees a draft, and never sees what the studio voided. */
const VISIBLE: ReadonlySet<Doc<'documents'>['status']> = new Set([
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'awaiting_signature',
  'partially_signed',
  'signed',
]);

async function clientDocument(ctx: QueryCtx | MutationCtx, documentId: Id<'documents'>, clientId: Id<'clients'>) {
  const document = await ctx.db.get('documents', documentId);
  // Another client's document, or one still being written, is simply not there.
  if (!document || document.clientId !== clientId || !VISIBLE.has(document.status)) return null;
  return document;
}

/**
 * Whether this contact may commit their client: an admin always, a member only where the studio named them — the same
 * rule the studio already set for signing (03-auth-and-permissions.md, Client roles; studio, 2026-09-24).
 */
async function canCommit(ctx: QueryCtx | MutationCtx, principal: ClientPrincipal, document: Doc<'documents'>) {
  if (principal.permissions.has('portal.colleagues.manage')) return true;
  if ((document.recipientContactIds ?? []).includes(principal.contact._id)) return true;
  // Named on the signing request for this document counts as being named by the studio.
  const requests = await ctx.db
    .query('signatureRequests')
    .withIndex('by_document', (q) => q.eq('documentId', document._id))
    .collect();
  return requests.some((request) =>
    request.signers.some((signer) => signer.contactId === principal.contact._id && signer.status !== 'declined'),
  );
}

/**
 * Where a document that is signed rather than accepted actually stands for this contact. The status alone says
 * `awaiting_signature` from the moment it is sent, whether or not anybody has been asked yet and whether or not this
 * is the person being asked — so telling them it needs their signature on that basis would often be untrue.
 */
async function signingFor(ctx: QueryCtx | MutationCtx, principal: ClientPrincipal, document: Doc<'documents'>) {
  const requests = await ctx.db
    .query('signatureRequests')
    .withIndex('by_document', (q) => q.eq('documentId', document._id))
    .collect();
  const open = requests.find((request) => request.status === 'pending');
  if (!open) return 'not_requested' as const;
  const mine = open.signers.find((signer) => signer.contactId === principal.contact._id);
  if (!mine) return 'others' as const;
  if (mine.status === 'signed') return 'signed_mine' as const;
  // Waiting behind somebody else in a sequential order: their link has not been sent yet.
  return mine.status === 'invited' ? ('mine' as const) : ('waiting_turn' as const);
}

function documentView(document: Doc<'documents'>) {
  return {
    id: document._id,
    type: document.type,
    typeLabel: TYPE_LABELS[document.type],
    number: document.number,
    title: document.title,
    status: document.status,
    currency: document.currency,
    totals: document.totals,
    validUntilDate: document.validUntilDate,
    sentAt: document.sentAt,
    acceptedAt: document.acceptedAt,
    declinedAt: document.declinedAt,
    declinedReason: document.declinedReason,
    signedAt: document.signedAt,
    pdfFileId: document.pdfFileId,
    // What the client is being asked to do with it, in their words.
    asks: ACCEPTED_TYPES.has(document.type) ? ('decision' as const) : ('signature' as const),
  };
}

export const list = portalQuery('portal.documents.view')({
  args: {},
  handler: async (ctx) => {
    const principal = ctx.principal as ClientPrincipal;
    const documents = await ctx.db
      .query('documents')
      .withIndex('by_client', (q) => q.eq('clientId', principal.clientId))
      .collect();
    const views = await Promise.all(
      documents
        .filter((document) => VISIBLE.has(document.status))
        .map(async (document) => ({
          ...documentView(document),
          signing: ACCEPTED_TYPES.has(document.type) ? null : await signingFor(ctx, principal, document),
        })),
    );
    return views.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
  },
});

/** One document as the client reads it: the wording with its variables filled, and what they can do about it. */
export const get = portalQuery('portal.documents.view')({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const principal = ctx.principal as ClientPrincipal;
    const document = await clientDocument(ctx, documentId, principal.clientId);
    if (!document) return null;

    const [client, project, settings] = await Promise.all([
      ctx.db.get('clients', document.clientId),
      document.projectId ? ctx.db.get('projects', document.projectId) : null,
      getOrgSettings(ctx),
    ]);
    if (!client) return null;
    const values = await variableValues(
      ctx,
      document,
      { client, contact: principal.contact, project, deal: null },
      localDateString(Date.now(), settings.timezone),
    );
    // A detail the studio has not filled in is left as it is rather than shown as a gap in the client's copy.
    const shown: Record<string, string> = Object.fromEntries(
      missingVariables(document.blocks, values).map((name: string) => [name, `{{${name}}}`]),
    );

    return {
      ...documentView(document),
      blocks: fillBlocks(document.blocks, { ...values, ...shown }),
      lineItems: document.lineItems ?? [],
      canDecide: DECIDABLE_STATUSES.has(document.status) && (await canCommit(ctx, principal, document)),
      signing: ACCEPTED_TYPES.has(document.type) ? null : await signingFor(ctx, principal, document),
    };
  },
});

/**
 * The client accepting or declining what they were sent. It records the same thing the studio's own `recordDecision`
 * does, with the contact as the actor rather than a member, so the timeline says who really decided.
 */
export const decide = portalMutation('portal.documents.view')({
  args: {
    documentId: v.id('documents'),
    decision: v.union(v.literal('accepted'), v.literal('declined')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { documentId, decision, note }) => {
    const principal = ctx.principal as ClientPrincipal;
    const document = await clientDocument(ctx, documentId, principal.clientId);
    if (!document) throw documentError('documents.notFound', 'That document is not available');
    if (!ACCEPTED_TYPES.has(document.type)) {
      throw documentError(
        'documents.notAccepted',
        `A ${TYPE_LABELS[document.type].toLowerCase()} is signed rather than accepted`,
      );
    }
    if (!DECIDABLE_STATUSES.has(document.status)) {
      throw documentError(
        'documents.decided',
        `This ${TYPE_LABELS[document.type].toLowerCase()} is ${document.status}`,
      );
    }
    if (!(await canCommit(ctx, principal, document))) {
      throw documentError(
        'documents.notYours',
        'This was sent to somebody else at your company; ask them to accept it, or an admin',
      );
    }
    const reason = text(note, 'Note', { max: 1000 });
    if (decision === 'declined' && !reason) throw documentError('documents.needsReason', 'Say why');

    const now = Date.now();
    await ctx.db.patch('documents', documentId, {
      status: decision,
      acceptedAt: decision === 'accepted' ? now : undefined,
      acceptedByContactId: decision === 'accepted' ? principal.contact._id : undefined,
      declinedAt: decision === 'declined' ? now : undefined,
      declinedReason: decision === 'declined' ? reason : undefined,
      decisionNote: reason,
      // They decided on what they were sent, never on changes the studio has not sent yet.
      decidedVersion: document.currentVersion,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'status_change',
      title: `${document.number ?? TYPE_LABELS[document.type]} ${decision} by ${principal.contact.name}`,
      body: reason,
      actor: { kind: 'client', id: principal.contact._id },
      meta: { documentId, decision },
    });
    return { status: decision };
  },
});
