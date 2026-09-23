import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { type TeamPrincipal } from './lib/principals';
import { auditedDatabase } from './lib/audit';
import { recordActivity, text } from './lib/crm';
import { documentError, SIGNED_TYPES } from './lib/documentBlocks';
import { getDocument, recordClientViewOf, TYPE_LABELS, visibleDocument } from './lib/documents';
import { consumeRateLimit } from './lib/enquiries';
import { recordUpload } from './lib/files';
import { internalMutation, internalQuery, teamMutation, teamQuery } from './lib/functions';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { getOrgSettings } from './lib/settings';
import { isOwner } from './lib/team';
import {
  allSigned,
  assertCanAct,
  CODE_TTL_MS,
  CONSENT_TEXT,
  CONSENT_VERSION,
  constantTimeEqual,
  DAY_MS,
  DEFAULT_EXPIRY_DAYS,
  FINAL_REMINDER_BEFORE_EXPIRY_MS,
  hasOpenRequest,
  MAX_CODE_ATTEMPTS,
  newCode,
  REMINDERS,
  sha256Hex,
  SIGNING_WINDOW_MS,
  signatureError,
  signersToInvite,
} from './lib/signatures';

// E-signatures (07-documents-and-esign.md, E-signatures; decisions of 2026-09-22). The studio sets up a request on a
// sent document; each client signer gets a link, confirms their email with a code, and signs through the public
// endpoints in convex/signing.ts. The studio countersigns inside the app. Links, codes and signatures follow the rules in
// convex/lib/signatures.ts.

type Ctx = QueryCtx | MutationCtx;
type Request = Doc<'signatureRequests'>;
type Signer = Request['signers'][number];

/** Documents a request can be set up on: sent, so there is a PDF and a hash to lock, and not yet decided or signed. */
const REQUESTABLE: ReadonlySet<Doc<'documents'>['status']> = new Set(['sent', 'viewed', 'awaiting_signature']);

/**
 * Quotes and proposals are accepted, not signed. Every other type may be: the signed types by default, and an SLA or a
 * change request when the studio chooses to set up a request for it (06-projects.md, Change requests).
 */
const ACCEPTED_TYPES: ReadonlySet<Doc<'documents'>['type']> = new Set(['quote', 'proposal']);

/** Where a document goes back to when its request closes unsigned: with the client, as it was after sending. */
const unsignedStatus = (document: Doc<'documents'>) =>
  SIGNED_TYPES.has(document.type) ? ('awaiting_signature' as const) : ('sent' as const);

const studioNameOf = (settings: { legalName?: string; tradingName?: string }) =>
  settings.tradingName ?? settings.legalName ?? 'Unbuilt Studio';

function requestView(request: Request, viewerId: Id<'teamMembers'>) {
  return {
    id: request._id,
    createdAt: request._creationTime,
    documentId: request.documentId,
    documentVersion: request.documentVersion,
    pdfSha256: request.pdfSha256,
    order: request.order,
    status: request.status,
    expiresAt: request.expiresAt,
    completedAt: request.completedAt,
    finalPdfFileId: request.finalPdfFileId,
    finalPdfSha256: request.finalPdfSha256,
    completionError: request.completionError,
    lastVerification: request.lastVerification,
    signers: request.signers.map((signer) => ({
      id: signer.id,
      name: signer.name,
      email: signer.email,
      kind: signer.kind,
      memberId: signer.memberId,
      order: signer.order,
      status: signer.status,
      invitedAt: signer.invitedAt,
      viewedAt: signer.viewedAt,
      signedAt: signer.signedAt,
      declinedAt: signer.declinedAt,
      declineReason: signer.declineReason,
      // So the page can offer the countersignature to the one member it belongs to.
      isViewer: signer.memberId === viewerId,
    })),
  };
}

export const listForDocument = teamQuery(null)({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    await visibleDocument(ctx, documentId);
    const requests = await ctx.db
      .query('signatureRequests')
      .withIndex('by_document', (q) => q.eq('documentId', documentId))
      .collect();
    return requests
      .map((request) => requestView(request, ctx.principal.member._id))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Who may be chosen to countersign: active members whose role holds documents.countersign. */
export const countersigners = teamQuery('documents.send')({
  args: {},
  handler: async (ctx) => {
    const ids = await activeMembersWith(ctx, 'documents.countersign');
    const members = await Promise.all(ids.map((id) => ctx.db.get('teamMembers', id)));
    return members
      .filter((member) => member !== null)
      .map((member) => ({ id: member._id, name: member.name, email: member.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

async function patchSigner(ctx: MutationCtx, request: Request, signerId: string, patch: Partial<Signer>) {
  await ctx.db.patch('signatureRequests', request._id, {
    signers: request.signers.map((signer) => (signer.id === signerId ? { ...signer, ...patch } : signer)),
  });
  return (await ctx.db.get('signatureRequests', request._id))!;
}

/**
 * Invites whoever is next: a client gets an email with their own link (the action mints the token, so only its hash is
 * ever stored), and a studio countersigner is told in the app, where they sign.
 */
async function inviteNext(ctx: MutationCtx, request: Request): Promise<Request> {
  let current = request;
  for (const signer of signersToInvite(current.order, current.signers)) {
    current = await patchSigner(ctx, current, signer.id, { status: 'invited', invitedAt: Date.now() });
    if (signer.kind === 'client_contact') {
      await ctx.scheduler.runAfter(0, internal.signatureSending.sendLink, {
        requestId: current._id,
        signerId: signer.id,
        reason: 'invitation',
      });
    } else if (signer.memberId) {
      const document = await ctx.db.get('documents', current.documentId);
      await notifyTeamMembers(ctx, [signer.memberId], {
        event: 'countersign_needed',
        title: `${document?.number ?? 'A document'} is ready for your countersignature`,
        body: document?.title ?? '',
        link: `/documents/${current.documentId}`,
      });
    }
  }
  return current;
}

export const createRequest = teamMutation('documents.send')({
  args: {
    documentId: v.id('documents'),
    contactIds: v.array(v.id('contacts')),
    countersignerMemberId: v.optional(v.id('teamMembers')),
    order: v.optional(v.union(v.literal('sequential'), v.literal('parallel'))),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const document = await visibleDocument(ctx, args.documentId);
    if (ACCEPTED_TYPES.has(document.type)) {
      throw signatureError(
        'signatures.notSigned',
        `A ${TYPE_LABELS[document.type].toLowerCase()} is accepted, not signed`,
      );
    }
    if (!REQUESTABLE.has(document.status) || !document.pdfSha256 || document.currentVersion === 0) {
      throw documentError(
        'documents.notSendable',
        document.status === 'signed'
          ? 'This document is already signed'
          : 'Send the document first, so there is a version and a PDF to sign',
      );
    }
    if (await hasOpenRequest(ctx, document._id)) {
      throw signatureError('signatures.open', 'This document already has a signing request in progress');
    }
    if (args.contactIds.length === 0) throw signatureError('signatures.noSigners', 'Choose at least one client signer');
    const days = args.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw signatureError('signatures.invalid', 'A signing request stays open for 1 to 90 days');
    }

    const signers: Signer[] = [];
    for (const [index, contactId] of [...new Set(args.contactIds)].entries()) {
      const contact = await ctx.db.get('contacts', contactId);
      if (!contact || contact.clientId !== document.clientId || contact.status !== 'active') {
        throw signatureError('signatures.invalid', 'Each signer must be an active contact at this client');
      }
      signers.push({
        id: `c${index + 1}`,
        name: contact.name,
        email: contact.email,
        kind: 'client_contact',
        contactId,
        order: index,
        status: 'waiting',
      });
    }
    if (args.countersignerMemberId) {
      const member = await ctx.db.get('teamMembers', args.countersignerMemberId);
      const role = member ? await ctx.db.get('roles', member.roleId) : null;
      if (!member || member.status !== 'active' || !role?.permissions.includes('documents.countersign')) {
        throw signatureError('signatures.invalid', 'The countersigner must be an active member who may countersign');
      }
      // The studio countersigns last, after every client.
      signers.push({
        id: 's1',
        name: member.name,
        email: member.email,
        kind: 'team_member',
        memberId: member._id,
        order: signers.length,
        status: 'waiting',
      });
    }

    const requestId = await ctx.db.insert('signatureRequests', {
      documentId: document._id,
      documentVersion: document.currentVersion,
      pdfSha256: document.pdfSha256,
      order: args.order ?? 'sequential',
      status: 'pending',
      expiresAt: Date.now() + days * DAY_MS,
      createdByMemberId: ctx.principal.member._id,
      signers,
    });
    await inviteNext(ctx, (await ctx.db.get('signatureRequests', requestId))!);
    await ctx.db.patch('documents', document._id, { status: 'awaiting_signature' });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'system',
      title: `${document.number} sent for signature to ${signers.map((signer) => signer.name).join(', ')}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { documentId: document._id, requestId },
    });
    return requestId;
  },
});

async function openRequest(ctx: MutationCtx & { principal: TeamPrincipal }, requestId: Id<'signatureRequests'>) {
  const request = await ctx.db.get('signatureRequests', requestId);
  if (!request) throw signatureError('signatures.notFound', 'Signing request not found');
  const document = await visibleDocument(ctx, request.documentId);
  return { request, document };
}

/** Stops a request. The document goes back to being with the client, so it can be re-sent or a new request set up. */
export const cancelRequest = teamMutation('documents.send')({
  args: { requestId: v.id('signatureRequests'), reason: v.string() },
  handler: async (ctx, { requestId, reason }) => {
    const { request, document } = await openRequest(ctx, requestId);
    if (request.status !== 'pending') throw signatureError('signatures.closed', `This request is ${request.status}`);
    await ctx.db.patch('signatureRequests', requestId, { status: 'cancelled' });
    await ctx.db.patch('documents', document._id, { status: unsignedStatus(document) });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'system',
      title: `Signing of ${document.number} cancelled`,
      body: text(reason, 'Reason', { required: true, max: 500 }),
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { documentId: document._id, requestId },
    });
  },
});

/**
 * Sends a client signer a fresh link, replacing the old one. It is also how a link locked by five wrong codes is
 * opened again, which the timeline records.
 */
export const resendLink = teamMutation('documents.send')({
  args: { requestId: v.id('signatureRequests'), signerId: v.string() },
  handler: async (ctx, { requestId, signerId }) => {
    const { request, document } = await openRequest(ctx, requestId);
    if (request.status !== 'pending') throw signatureError('signatures.closed', `This request is ${request.status}`);
    const signer = request.signers.find((candidate) => candidate.id === signerId);
    if (!signer || signer.kind !== 'client_contact') throw signatureError('signatures.notFound', 'Signer not found');
    if (signer.status !== 'invited' && signer.status !== 'locked') {
      throw signatureError(
        'signatures.invalid',
        'Only a signer who has been invited and not yet signed gets a new link',
      );
    }
    await patchSigner(ctx, request, signerId, {
      status: 'invited',
      codeHash: undefined,
      codeExpiresAt: undefined,
      codeAttempts: 0,
      otpVerifiedAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.signatureSending.sendLink, { requestId, signerId, reason: 'resend' });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'system',
      title: `New signing link sent to ${signer.name}${signer.status === 'locked' ? ' after too many wrong codes' : ''}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { documentId: document._id, requestId },
    });
  },
});

/**
 * The studio's countersignature, given inside the app. The signed-in session already passed the member's two-factor
 * check, which is what the certificate records in place of an emailed code.
 */
/** Where the countersigner's drawn signature is uploaded, before countersign records it. */
export const countersignUploadUrl = teamMutation('documents.countersign')({
  args: { requestId: v.id('signatureRequests') },
  handler: async (ctx, { requestId }) => {
    const { request } = await openRequest(ctx, requestId);
    const signer = request.signers.find(
      (candidate) => candidate.kind === 'team_member' && candidate.memberId === ctx.principal.member._id,
    );
    if (!signer) throw signatureError('signatures.notYours', 'You are not the countersigner on this request');
    assertCanAct(request, signer, Date.now());
    return await ctx.storage.generateUploadUrl();
  },
});

export const countersign = teamMutation('documents.countersign')({
  args: {
    requestId: v.id('signatureRequests'),
    method: v.optional(v.union(v.literal('typed'), v.literal('drawn'))),
    typedName: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    consent: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const { request, document } = await openRequest(ctx, args.requestId);
    const signer = request.signers.find(
      (candidate) => candidate.kind === 'team_member' && candidate.memberId === ctx.principal.member._id,
    );
    if (!signer) throw signatureError('signatures.notYours', 'You are not the countersigner on this request');
    const now = Date.now();
    assertCanAct(request, signer, now);
    if (!args.consent) throw signatureError('signatures.consent', 'Tick the consent statement to sign');
    const method = args.method ?? 'typed';
    // The name is kept either way: it is what the Name line and the certificate carry.
    const typedName = text(args.typedName, 'Your full name', { required: true, max: 120 })!;
    let imageFileId: Id<'files'> | undefined;
    if (method === 'drawn') {
      if (!args.imageStorageId) throw signatureError('signatures.invalid', 'Draw your signature to sign');
      const upload = await recordUpload(ctx, {
        storageId: args.imageStorageId,
        name: `signature-${signer.id}.png`,
        contentType: 'image/png',
        context: 'image',
        owner: { table: 'signatureRequests', id: request._id },
        visibility: 'internal',
        clientId: document.clientId,
        uploadedBy: { kind: 'team', id: ctx.principal.member._id },
      });
      // Returned, not thrown: throwing would roll back the upload's removal from storage.
      if (!upload.ok) return { ok: false, message: upload.message };
      imageFileId = upload.fileId;
    }
    await recordSignature(ctx, request, signer, {
      method,
      typedName,
      imageFileId,
      otpVerifiedAt: ctx.principal.session.signedInAt,
      verification: 'app_session',
      ip: ctx.principal.session.ip,
      userAgent: ctx.principal.session.userAgent,
      now,
    });
    return { ok: true };
  },
});

/** Writes the evidence, marks the signer, and moves the request and the document on. */
async function recordSignature(
  ctx: MutationCtx,
  request: Request,
  signer: Signer,
  evidence: {
    method: 'typed' | 'drawn';
    typedName?: string;
    imageFileId?: Id<'files'>;
    otpVerifiedAt: number;
    verification: 'email_code' | 'app_session';
    ip?: string;
    userAgent?: string;
    now: number;
  },
) {
  await ctx.db.insert('signatures', {
    signatureRequestId: request._id,
    signerId: signer.id,
    method: evidence.method,
    typedName: evidence.typedName,
    imageFileId: evidence.imageFileId,
    consentText: CONSENT_TEXT,
    consentVersion: CONSENT_VERSION,
    ip: evidence.ip,
    userAgent: evidence.userAgent,
    otpVerifiedAt: evidence.otpVerifiedAt,
    verification: evidence.verification,
    signedAt: evidence.now,
    documentSha256: request.pdfSha256,
  });
  let current = await patchSigner(ctx, request, signer.id, {
    status: 'signed',
    signedAt: evidence.now,
    codeHash: undefined,
    codeExpiresAt: undefined,
  });

  const document = await getDocument(ctx, request.documentId);
  if (allSigned(current.signers)) {
    await ctx.db.patch('signatureRequests', current._id, { status: 'completed', completedAt: evidence.now });
    await ctx.db.patch('documents', document._id, { status: 'signed', signedAt: evidence.now });
    await ctx.scheduler.runAfter(0, internal.signatureCompletion.complete, { requestId: current._id });
    // A signed contract may be what a billing schedule was waiting for (08-billing-and-finance.md).
    await ctx.scheduler.runAfter(0, internal.billingSchedules.onDocumentSigned, { documentId: document._id });
  } else {
    current = await inviteNext(ctx, current);
    await ctx.db.patch('documents', document._id, { status: 'partially_signed' });
  }
  await recordActivity(ctx, {
    subject: { table: 'clients', id: document.clientId },
    clientId: document.clientId,
    type: 'system',
    title: `${signer.name} signed ${document.number}`,
    actor:
      signer.kind === 'team_member' && signer.memberId ? { kind: 'team', id: signer.memberId } : { kind: 'system' },
    meta: { documentId: document._id, requestId: current._id, signerId: signer.id },
  });
}

// The public signing flow -------------------------------------------------------------------------------------------
// Called by the HTTP endpoints in convex/signing.ts, which pass the link's token as given; only its hash is looked up.

async function signerForToken(ctx: Ctx, token: string) {
  const tokenHash = await sha256Hex(token);
  const link = await ctx.db
    .query('signingLinks')
    .withIndex('by_token', (q) => q.eq('tokenHash', tokenHash))
    .unique();
  const request = link ? await ctx.db.get('signatureRequests', link.signatureRequestId) : null;
  const signer = request?.signers.find(
    (candidate) => candidate.id === link?.signerId && candidate.tokenHash === tokenHash,
  );
  // A link that does not match is simply not found: nothing tells a guesser what exists.
  if (!request || !signer) throw signatureError('signatures.notFound', 'This signing link is not valid');
  return { request, signer };
}

/** Internal mutations get the plain database; a signer's writes are audited as theirs, like any other change. */
function asSigner<C extends MutationCtx>(ctx: C, signer: Signer, from: { ip?: string; userAgent?: string } = {}): C {
  return {
    ...ctx,
    db: auditedDatabase(ctx.db, {
      actorKind: 'client',
      actorId: signer.contactId,
      permission: 'signing.link',
      ip: from.ip,
      userAgent: from.userAgent,
    }),
  };
}

/** Stores the hash of a freshly minted link, replacing any earlier link for this signer. */
export const setLink = internalMutation({
  args: { requestId: v.id('signatureRequests'), signerId: v.string(), tokenHash: v.string() },
  handler: async (ctx, { requestId, signerId, tokenHash }) => {
    const request = await ctx.db.get('signatureRequests', requestId);
    const signer = request?.signers.find((candidate) => candidate.id === signerId);
    // The request may have closed, or the signer finished, between scheduling and sending.
    if (!request || request.status !== 'pending' || signer?.status !== 'invited') return null;
    const old = await ctx.db
      .query('signingLinks')
      .withIndex('by_request_signer', (q) => q.eq('signatureRequestId', requestId).eq('signerId', signerId))
      .collect();
    for (const link of old) await ctx.db.delete('signingLinks', link._id);
    await ctx.db.insert('signingLinks', { tokenHash, signatureRequestId: requestId, signerId });
    await patchSigner(ctx, request, signerId, { tokenHash });
    const document = await getDocument(ctx, request.documentId);
    const settings = await getOrgSettings(ctx);
    return {
      email: signer.email,
      name: signer.name,
      documentTitle: document.title,
      documentNumber: document.number ?? '',
      typeLabel: TYPE_LABELS[document.type],
      studioName: studioNameOf(settings),
      expiresAt: request.expiresAt,
    };
  },
});

/** A link email did not go out: whoever set the request up is told, so they can send it again from the document. */
export const reportLinkFailed = internalMutation({
  args: { requestId: v.id('signatureRequests'), signerId: v.string(), reason: v.string() },
  handler: async (ctx, { requestId, signerId, reason }) => {
    const request = await ctx.db.get('signatureRequests', requestId);
    const signer = request?.signers.find((candidate) => candidate.id === signerId);
    if (!request || !signer) return;
    const document = await ctx.db.get('documents', request.documentId);
    await notifyTeamMembers(ctx, [request.createdByMemberId], {
      event: 'signing_link_failed',
      title: `The signing link for ${signer.name} did not go out`,
      body: `${document?.number ?? 'The document'}: ${reason.slice(0, 200)}`,
      link: `/documents/${request.documentId}`,
    });
  },
});

/** What the signer sees: the version the request locked, never a later edit. */
export const viewByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { request, signer } = await signerForToken(ctx, token);
    const document = await getDocument(ctx, request.documentId);
    const version = await ctx.db
      .query('documentVersions')
      .withIndex('by_document_version', (q) =>
        q.eq('documentId', request.documentId).eq('version', request.documentVersion),
      )
      .unique();
    const client = await ctx.db.get('clients', document.clientId);
    const summary = {
      signer: { name: signer.name, email: signer.email, status: signer.status, codeVerified: codeStillValid(signer) },
      request: { status: request.status, expiresAt: request.expiresAt, expired: Date.now() >= request.expiresAt },
      studioName: studioNameOf(await getOrgSettings(ctx)),
      title: document.title,
      number: document.number,
      typeLabel: TYPE_LABELS[document.type],
    };
    // A link outlives its request so the signer can see what happened, but the document is only shown while it is
    // theirs to sign.
    const open = request.status === 'pending' && Date.now() < request.expiresAt && signer.status === 'invited';
    if (!open) return { ...summary, document: null, consent: null };
    return {
      ...summary,
      document: {
        clientName: client?.displayName,
        currency: document.currency,
        blocks: version?.blocks ?? [],
        lineItems: version?.lineItems,
        totals: version?.totals,
        pdfFileId: version?.pdfFileId,
        pdfSha256: request.pdfSha256,
      },
      consent: { text: CONSENT_TEXT, version: CONSENT_VERSION },
    };
  },
});

const codeStillValid = (signer: Signer) =>
  signer.otpVerifiedAt !== undefined && Date.now() - signer.otpVerifiedAt < SIGNING_WINDOW_MS;

/** A signer opened their link: a client view of the document, and the first one is kept on the signer. */
export const markViewed = internalMutation({
  args: { token: v.string(), ip: v.string(), userAgent: v.optional(v.string()) },
  handler: async (raw, { token, ip, userAgent }) => {
    const { request, signer } = await signerForToken(raw, token);
    const ctx = asSigner(raw, signer, { ip, userAgent });
    if (signer.viewedAt === undefined) await patchSigner(ctx, request, signer.id, { viewedAt: Date.now() });
    await recordClientViewOf(ctx, {
      documentId: request.documentId,
      contactId: signer.contactId,
      viewerKind: 'token',
      ip,
      userAgent,
    });
    return null;
  },
});

/** Issues a fresh code for the signer to confirm their email, returning it to the endpoint that emails it. */
export const issueCode = internalMutation({
  args: { token: v.string(), ip: v.string() },
  handler: async (raw, { token, ip }) => {
    const { request, signer } = await signerForToken(raw, token);
    const ctx = asSigner(raw, signer, { ip });
    const now = Date.now();
    assertCanAct(request, signer, now);
    // A code is cheap to ask for; the limits stop a link or an address being used to flood an inbox.
    const hour = 60 * 60 * 1000;
    const perSigner = await consumeRateLimit(
      ctx.db,
      `sign:code:${request._id}:${signer.id}`,
      { max: 5, windowMs: hour },
      now,
    );
    const perIp = await consumeRateLimit(ctx.db, `sign:code:ip:${ip}`, { max: 20, windowMs: hour }, now);
    if (!perSigner || !perIp) {
      throw signatureError('signatures.rateLimited', 'Too many codes asked for. Try again later.');
    }
    const code = newCode();
    // The wrong tries are not reset: five across every code lock the link, so asking for new codes buys no guesses.
    await patchSigner(ctx, request, signer.id, { codeHash: await sha256Hex(code), codeExpiresAt: now + CODE_TTL_MS });
    const document = await getDocument(ctx, request.documentId);
    return { code, email: signer.email, documentNumber: document.number ?? '' };
  },
});

/** Checks a code. Five wrong tries lock the link until the studio sends a new one. */
export const verifyCode = internalMutation({
  args: { token: v.string(), code: v.string(), ip: v.string(), userAgent: v.optional(v.string()) },
  handler: async (raw, { token, code, ip, userAgent }) => {
    const { request, signer } = await signerForToken(raw, token);
    const ctx = asSigner(raw, signer, { ip, userAgent });
    const now = Date.now();
    assertCanAct(request, signer, now);
    if (!signer.codeHash || signer.codeExpiresAt === undefined || now >= signer.codeExpiresAt) {
      throw signatureError('signatures.codeExpired', 'That code has expired. Ask for a new one.');
    }
    if (constantTimeEqual(await sha256Hex(code.trim()), signer.codeHash)) {
      await patchSigner(ctx, request, signer.id, { otpVerifiedAt: now, codeHash: undefined, codeExpiresAt: undefined });
      return { ok: true as const };
    }
    const attempts = (signer.codeAttempts ?? 0) + 1;
    const locked = attempts >= MAX_CODE_ATTEMPTS;
    await patchSigner(ctx, request, signer.id, {
      codeAttempts: attempts,
      ...(locked ? { status: 'locked' as const, codeHash: undefined, codeExpiresAt: undefined } : {}),
    });
    if (locked) {
      const document = await getDocument(ctx, request.documentId);
      await notifyTeamMembers(ctx, [request.createdByMemberId], {
        event: 'signing_locked',
        title: `${signer.name}'s signing link was locked`,
        body: `Too many wrong codes on ${document.number}. Send them a new link from the document.`,
        link: `/documents/${document._id}`,
      });
    }
    return { ok: false as const, locked, attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - attempts) };
  },
});

function assertVerified(signer: Signer, now: number) {
  if (signer.otpVerifiedAt === undefined || now - signer.otpVerifiedAt >= SIGNING_WINDOW_MS) {
    throw signatureError('signatures.codeNeeded', 'Confirm your email with a code first');
  }
}

/** Before a drawn signature is uploaded: the signer may act and has confirmed their email. */
export const assertReadyToSign = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { request, signer } = await signerForToken(ctx, token);
    const now = Date.now();
    assertCanAct(request, signer, now);
    assertVerified(signer, now);
    return null;
  },
});

/** A client's signature, after their code was checked. A drawn signature arrives as an image already in storage. */
export const signByToken = internalMutation({
  args: {
    token: v.string(),
    method: v.union(v.literal('typed'), v.literal('drawn')),
    typedName: v.optional(v.string()),
    // A string from the public endpoint, checked here, so a made-up id is refused like any other bad input.
    imageStorageId: v.optional(v.string()),
    consent: v.boolean(),
    ip: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (raw, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const { request, signer } = await signerForToken(raw, args.token);
    const ctx = asSigner(raw, signer, args);
    const now = Date.now();
    assertCanAct(request, signer, now);
    assertVerified(signer, now);
    if (!args.consent) throw signatureError('signatures.consent', 'Tick the consent statement to sign');

    const typedName = text(args.typedName, 'Your full name', { max: 120 });
    let imageFileId: Id<'files'> | undefined;
    if (args.method === 'typed' && !typedName) {
      throw signatureError('signatures.invalid', 'Type your full name to sign');
    }
    if (args.method === 'drawn') {
      const storageId = args.imageStorageId ? ctx.db.system.normalizeId('_storage', args.imageStorageId) : null;
      if (!storageId) throw signatureError('signatures.invalid', 'Draw your signature to sign');
      const document = await getDocument(ctx, request.documentId);
      const upload = await recordUpload(ctx, {
        storageId,
        name: `signature-${signer.id}.png`,
        contentType: 'image/png',
        context: 'image',
        owner: { table: 'signatureRequests', id: request._id },
        visibility: 'internal',
        clientId: document.clientId,
        uploadedBy: { kind: 'client', id: signer.contactId ?? signer.id },
      });
      // Returned, not thrown: throwing would roll back the upload's removal from storage.
      if (!upload.ok) return { ok: false, message: upload.message };
      imageFileId = upload.fileId;
    }
    await recordSignature(ctx, request, signer, {
      method: args.method,
      typedName,
      imageFileId,
      otpVerifiedAt: signer.otpVerifiedAt!,
      verification: 'email_code',
      ip: args.ip,
      userAgent: args.userAgent,
      now,
    });
    return { ok: true };
  },
});

/** Declining ends the request for everyone, with the signer's reason, and tells whoever set it up. */
export const declineByToken = internalMutation({
  args: { token: v.string(), reason: v.string(), ip: v.string(), userAgent: v.optional(v.string()) },
  handler: async (raw, args) => {
    const { request, signer } = await signerForToken(raw, args.token);
    const ctx = asSigner(raw, signer, args);
    const now = Date.now();
    assertCanAct(request, signer, now);
    // The same check as signing, so a forwarded link cannot be used to turn a document down.
    assertVerified(signer, now);
    const reason = text(args.reason, 'Your reason', { required: true, max: 1000 })!;
    await patchSigner(ctx, request, signer.id, { status: 'declined', declinedAt: now, declineReason: reason });
    await ctx.db.patch('signatureRequests', request._id, { status: 'declined' });
    const document = await getDocument(ctx, request.documentId);
    await ctx.db.patch('documents', document._id, { status: 'declined', declinedAt: now, declinedReason: reason });
    await notifyTeamMembers(ctx, [request.createdByMemberId], {
      event: 'signing_declined',
      title: `${signer.name} declined to sign ${document.number}`,
      body: reason,
      link: `/documents/${document._id}`,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'status_change',
      title: `${signer.name} declined to sign ${document.number}`,
      body: reason,
      actor: { kind: 'system' },
      meta: { documentId: document._id, requestId: request._id, ip: args.ip },
    });
    return null;
  },
});

// Housekeeping ------------------------------------------------------------------------------------------------------

/** Reminds pending client signers 3 and 7 days after their invitation, and once more the day before it expires. */
export const sendReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query('signatureRequests')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .collect();
    let sent = 0;
    for (const request of pending) {
      if (now >= request.expiresAt) continue;
      let current = request;
      for (const signer of request.signers) {
        if (signer.kind !== 'client_contact' || signer.status !== 'invited' || signer.invitedAt === undefined) continue;
        const already = new Set(signer.remindersSent ?? []);
        const due = [
          ...REMINDERS.filter((reminder) => now - signer.invitedAt! >= reminder.afterInviteMs).map((r) => r.key),
          ...(request.expiresAt - now <= FINAL_REMINDER_BEFORE_EXPIRY_MS ? ['final'] : []),
        ].filter((key) => !already.has(key));
        // One reminder a day at most, even if more than one is due.
        const key = due.at(-1);
        if (!key) continue;
        current = await patchSigner(ctx, current, signer.id, { remindersSent: [...already, ...due] });
        await ctx.scheduler.runAfter(0, internal.signatureSending.sendLink, {
          requestId: request._id,
          signerId: signer.id,
          reason: key === 'final' ? 'final_reminder' : 'reminder',
        });
        sent++;
      }
    }
    return { sent };
  },
});

/** Requests past their date expire. The document goes back to being with the client, so a new one can be set up. */
export const expireRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query('signatureRequests')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .collect();
    const expired = pending.filter((request) => now >= request.expiresAt);
    for (const request of expired) {
      await ctx.db.patch('signatureRequests', request._id, { status: 'expired' });
      const document = await ctx.db.get('documents', request.documentId);
      if (document && (document.status === 'awaiting_signature' || document.status === 'partially_signed')) {
        await ctx.db.patch('documents', document._id, { status: unsignedStatus(document) });
      }
      await notifyTeamMembers(ctx, [request.createdByMemberId], {
        event: 'signing_expired',
        title: `Signing of ${document?.number ?? 'a document'} expired`,
        body: 'Nobody has signed everything in time. Set up a new request from the document.',
        link: `/documents/${request.documentId}`,
      });
    }
    return { expired: expired.length };
  },
});

/** Active members holding the Owner role. */
async function ownerMemberIds(ctx: Ctx): Promise<Id<'teamMembers'>[]> {
  const roles = await ctx.db
    .query('roles')
    .withIndex('by_key', (q) => q.eq('key', 'owner'))
    .collect();
  const ids: Id<'teamMembers'>[] = [];
  for (const role of roles.filter((candidate) => isOwner(candidate))) {
    const members = await ctx.db
      .query('teamMembers')
      .withIndex('by_role', (q) => q.eq('roleId', role._id))
      .collect();
    ids.push(...members.filter((member) => member.status === 'active').map((member) => member._id));
  }
  return ids;
}

// Completion and the tamper check ---------------------------------------------------------------------------------
// The work that needs file bytes runs in convex/signatureCompletion.ts, a Node action; these read and record for it.

/** Everything the completion action needs: the locked PDF, the evidence for the certificate, and who gets a copy. */
export const completionData = internalQuery({
  args: { requestId: v.id('signatureRequests') },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get('signatureRequests', requestId);
    if (!request || request.status !== 'completed') return null;
    const document = await getDocument(ctx, request.documentId);
    const version = await ctx.db
      .query('documentVersions')
      .withIndex('by_document_version', (q) =>
        q.eq('documentId', request.documentId).eq('version', request.documentVersion),
      )
      .unique();
    const pdf = version?.pdfFileId ? await ctx.db.get('files', version.pdfFileId) : null;
    if (!pdf) throw signatureError('signatures.noPdf', 'The signed version has no stored PDF');
    const settings = await getOrgSettings(ctx);
    const evidence = await ctx.db
      .query('signatures')
      .withIndex('by_request', (q) => q.eq('signatureRequestId', requestId))
      .collect();
    const signers = [];
    for (const signer of [...request.signers].sort((a, b) => a.order - b.order)) {
      const signature = evidence.find((row) => row.signerId === signer.id);
      if (!signature) throw signatureError('signatures.missing', `No signature is recorded for ${signer.name}`);
      const image = signature.imageFileId ? await ctx.db.get('files', signature.imageFileId) : null;
      signers.push({
        name: signer.name,
        email: signer.email,
        party: signer.kind === 'team_member' ? ('studio' as const) : ('client' as const),
        role: signer.kind === 'team_member' ? studioNameOf(settings) : 'Client',
        method: signature.method,
        typedName: signature.typedName,
        imageStorageId: image?.storageId,
        verification: signature.verification,
        otpVerifiedAt: signature.otpVerifiedAt,
        signedAt: signature.signedAt,
        ip: signature.ip,
        userAgent: signature.userAgent,
        consentText: signature.consentText,
        consentVersion: signature.consentVersion,
      });
    }
    return {
      originalStorageId: pdf.storageId,
      pdfSha256: request.pdfSha256,
      // What the locked PDF was drawn from, when it was kept, so the signed copy can carry the signatures on its lines.
      pdfPayload: version?.pdfPayload,
      fileName: `${document.number ?? 'document'}-signed.pdf`,
      certificate: {
        org: { name: studioNameOf(settings) },
        brand: { primary: settings.brand.primary },
        typeLabel: TYPE_LABELS[document.type],
        number: document.number ?? '',
        title: document.title,
        documentSha256: request.pdfSha256,
        completedAt: request.completedAt ?? document.signedAt ?? 0,
      },
      signers,
    };
  },
});

/** Stores the signed PDF like any other upload, on the document, where every reader of the document can fetch it. */
export const attachFinalPdf = internalMutation({
  args: { requestId: v.id('signatureRequests'), storageId: v.id('_storage'), fileName: v.string(), sha256: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const request = await ctx.db.get('signatureRequests', args.requestId);
    if (!request || request.status !== 'completed') return { ok: false, message: 'The request is not completed' };
    if (request.finalPdfFileId) return { ok: true };
    const document = await getDocument(ctx, request.documentId);
    const upload = await recordUpload(ctx, {
      storageId: args.storageId,
      name: args.fileName,
      contentType: 'application/pdf',
      context: 'document',
      owner: { table: 'documents', id: document._id },
      visibility: 'client',
      clientId: document.clientId,
      projectId: document.projectId,
      uploadedBy: { kind: 'system', id: 'signatures' },
    });
    if (!upload.ok) return { ok: false, message: upload.message };
    const file = (await ctx.db.get('files', upload.fileId))!;
    // Storage computes its own hash of what it holds; the two agreeing means the stored bytes are the ones rendered.
    if (file.sha256 !== args.sha256) return { ok: false, message: 'The stored PDF does not match what was rendered' };
    await ctx.db.patch('signatureRequests', request._id, {
      finalPdfFileId: upload.fileId,
      finalPdfSha256: args.sha256,
      completionError: undefined,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'status_change',
      title: `${document.number} is signed by everyone`,
      actor: { kind: 'system' },
      meta: { documentId: document._id, requestId: request._id },
    });
    await notifyTeamMembers(ctx, [request.createdByMemberId], {
      event: 'document_signed',
      title: `${document.number} is signed`,
      body: `${document.title}. The signed PDF, with its certificate, is on the document.`,
      link: `/documents/${document._id}`,
    });
    return { ok: true };
  },
});

/** The completion action failed: kept on the request, and whoever set it up is told, so it can be run again. */
export const reportCompletionFailed = internalMutation({
  args: { requestId: v.id('signatureRequests'), reason: v.string() },
  handler: async (ctx, { requestId, reason }) => {
    const request = await ctx.db.get('signatureRequests', requestId);
    if (!request) return;
    await ctx.db.patch('signatureRequests', requestId, { completionError: reason.slice(0, 500) });
    const document = await ctx.db.get('documents', request.documentId);
    await notifyTeamMembers(ctx, [request.createdByMemberId], {
      event: 'signing_completion_failed',
      title: `The signed PDF for ${document?.number ?? 'a document'} could not be made`,
      body: `${reason.slice(0, 200)} Everyone's signature is recorded; try again from the document.`,
      link: `/documents/${request.documentId}`,
    });
  },
});

/** Runs completion again after a failure. The signatures are already recorded; only the PDF and emails are redone. */
export const retryCompletion = teamMutation('documents.send')({
  args: { requestId: v.id('signatureRequests') },
  handler: async (ctx, { requestId }) => {
    const { request } = await openRequest(ctx, requestId);
    if (request.status !== 'completed' || request.finalPdfFileId) {
      throw signatureError(
        'signatures.invalid',
        'Only a completed request without its signed PDF can be finished again',
      );
    }
    await ctx.db.patch('signatureRequests', requestId, { completionError: undefined });
    await ctx.scheduler.runAfter(0, internal.signatureCompletion.complete, { requestId });
  },
});

/**
 * The tamper check: recomputes the hash of the stored PDFs and compares them with the recorded ones. Anyone who can
 * read the document may ask; the result lands on the request and, if anything differs, the Owner and the asker are told.
 */
export const verify = teamMutation(null)({
  args: { requestId: v.id('signatureRequests') },
  handler: async (ctx, { requestId }) => {
    const { request } = await openRequest(ctx, requestId);
    if (request.status !== 'completed' || !request.finalPdfFileId) {
      throw signatureError('signatures.invalid', 'Only a signed document can be verified');
    }
    await ctx.scheduler.runAfter(0, internal.signatureCompletion.verify, {
      requestId,
      memberId: ctx.principal.member._id,
    });
  },
});

export const verificationData = internalQuery({
  args: { requestId: v.id('signatureRequests') },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get('signatureRequests', requestId);
    if (!request?.finalPdfFileId || !request.finalPdfSha256) return null;
    const version = await ctx.db
      .query('documentVersions')
      .withIndex('by_document_version', (q) =>
        q.eq('documentId', request.documentId).eq('version', request.documentVersion),
      )
      .unique();
    const original = version?.pdfFileId ? await ctx.db.get('files', version.pdfFileId) : null;
    const signed = await ctx.db.get('files', request.finalPdfFileId);
    return {
      original: original ? { storageId: original.storageId, sha256: request.pdfSha256 } : null,
      signed: signed ? { storageId: signed.storageId, sha256: request.finalPdfSha256 } : null,
    };
  },
});

export const recordVerification = internalMutation({
  args: { requestId: v.id('signatureRequests'), memberId: v.id('teamMembers'), ok: v.boolean() },
  handler: async (ctx, { requestId, memberId, ok }) => {
    const request = await ctx.db.get('signatureRequests', requestId);
    if (!request) return;
    await ctx.db.patch('signatureRequests', requestId, {
      lastVerification: { checkedAt: Date.now(), ok, byMemberId: memberId },
    });
    if (!ok) {
      const document = await ctx.db.get('documents', request.documentId);
      const owners = await ownerMemberIds(ctx);
      await notifyTeamMembers(ctx, [memberId, ...owners], {
        event: 'signing_tamper',
        title: `The stored PDF for ${document?.number ?? 'a signed document'} has changed`,
        body: 'Its fingerprint no longer matches the one recorded when it was signed.',
        link: `/documents/${request.documentId}`,
      });
    }
  },
});
