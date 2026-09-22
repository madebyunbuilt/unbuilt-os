import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { defaultTemplateFor } from './documentTemplates';
import { getClient, recordActivity, requirePermission, text } from './lib/crm';
import {
  blockValidator,
  type DocumentBlock,
  documentError,
  documentType,
  missingVariables,
  PRICED_TYPES,
  SIGNED_TYPES,
} from './lib/documentBlocks';
import {
  type AttachedPdf,
  DECIDABLE_STATUSES,
  documentTotals,
  EDITABLE_STATUSES,
  FINAL_STATUSES,
  getDocument,
  type LineItem,
  visibleDocument,
  copyClausesIn,
  describeMissing,
  fillBlocks,
  type MissingDetail,
  numberedRecordFor,
  type PreparedSend,
  recordClientViewOf,
  taxSettingsFor,
  TYPE_LABELS,
  variableValues,
} from './lib/documents';
import { recordUpload } from './lib/files';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { portalAppOrigin } from './lib/hosts';
import { nextNumber } from './lib/numbering';
import { type Currency } from './lib/money';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { type TeamPrincipal } from './lib/principals';
import { inProjectScope } from './lib/projects';
import { getOrgSettings } from './lib/settings';
import { localDateString } from './lib/businessTime';
import { closeOpenRequests, hasOpenRequest } from './lib/signatures';
import { isIsoDate } from './lib/validation';

// Documents (07-documents-and-esign.md). A draft is created from a template and owns its text from then on. Sending,
// PDF rendering and signing arrive in the next steps; until the client portal exists, the studio records a client's
// decision itself, and the document says who recorded it.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };

const DEFAULT_VALIDITY_DAYS = 30;

const lineItemValidator = v.object({
  description: v.string(),
  quantityMilli: v.number(),
  unitPriceMinor: v.number(),
  rateCardItemId: v.optional(v.id('rateCardItems')),
  taxable: v.optional(v.boolean()),
});

const discountValidator = v.object({
  kind: v.union(v.literal('none'), v.literal('percent'), v.literal('fixed')),
  bps: v.optional(v.number()),
  amountMinor: v.optional(v.number()),
});

/** The same rule for a list: every document, or only those on the caller's projects. */
async function visibleDocuments(ctx: Ctx & Principal, documents: Doc<'documents'>[]) {
  if (ctx.principal.permissions.has('documents.view')) return documents;
  requirePermission(ctx.principal, 'documents.view.assigned');
  const allowed: Doc<'documents'>[] = [];
  for (const document of documents) {
    if (document.projectId && (await inProjectScope(ctx, ctx.principal, document.projectId))) allowed.push(document);
  }
  return allowed;
}

function checkedDate(value: string | undefined, label: string) {
  if (!value) return undefined;
  if (!isIsoDate(value)) throw documentError('documents.invalid', `${label} must be a date`);
  return value;
}

function checkedLineItems(items: (typeof lineItemValidator.type)[]): LineItem[] {
  return items.map((item) => {
    if (!Number.isInteger(item.quantityMilli) || item.quantityMilli <= 0) {
      throw documentError('documents.invalid', 'Each line needs a quantity above zero');
    }
    if (!Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) {
      throw documentError('documents.invalid', 'Each line needs a whole, non-negative price');
    }
    return {
      description: text(item.description, 'Line description', { required: true, max: 500 })!,
      quantityMilli: item.quantityMilli,
      unitPriceMinor: item.unitPriceMinor,
      amountMinor: 0,
      rateCardItemId: item.rateCardItemId,
      taxable: item.taxable ?? true,
    };
  });
}

async function studioToday(ctx: Ctx) {
  return localDateString(Date.now(), (await getOrgSettings(ctx)).timezone);
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function documentView(document: Doc<'documents'>, extras: { clientName: string; projectName?: string }) {
  return {
    id: document._id,
    type: document.type,
    typeLabel: TYPE_LABELS[document.type],
    number: document.number,
    title: document.title,
    status: document.status,
    clientId: document.clientId,
    clientName: extras.clientName,
    projectId: document.projectId,
    projectName: extras.projectName,
    dealId: document.dealId,
    currency: document.currency,
    totals: document.totals,
    validUntilDate: document.validUntilDate,
    currentVersion: document.currentVersion,
    parentDocumentId: document.parentDocumentId,
    chainRootId: document.chainRootId ?? document._id,
    sentAt: document.sentAt,
    firstViewedAt: document.firstViewedAt,
    viewCount: document.viewCount,
    acceptedAt: document.acceptedAt,
    declinedAt: document.declinedAt,
    declinedReason: document.declinedReason,
    decisionNote: document.decisionNote,
    signedAt: document.signedAt,
    voidReason: document.voidReason,
    pdfFileId: document.pdfFileId,
    pdfSha256: document.pdfSha256,
    createdAt: document._creationTime,
  };
}

async function withNames(ctx: Ctx, document: Doc<'documents'>) {
  const [client, project] = await Promise.all([
    ctx.db.get('clients', document.clientId),
    document.projectId ? ctx.db.get('projects', document.projectId) : null,
  ]);
  return documentView(document, {
    clientName: client?.displayName ?? 'Unknown client',
    projectName: project?.name,
  });
}

export const list = teamQuery(null)({
  args: {
    clientId: v.optional(v.id('clients')),
    projectId: v.optional(v.id('projects')),
    type: v.optional(documentType),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const all = args.clientId
      ? await ctx.db
          .query('documents')
          .withIndex('by_client', (q) => q.eq('clientId', args.clientId!))
          .collect()
      : args.projectId
        ? await ctx.db
            .query('documents')
            .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
            .collect()
        : await ctx.db.query('documents').take(1000);
    const visible = await visibleDocuments(ctx, all);
    const filtered = visible.filter(
      (document) => (!args.type || document.type === args.type) && (!args.status || document.status === args.status),
    );
    const views = await Promise.all(filtered.map((document) => withNames(ctx, document)));
    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** One document with its blocks, its line items and the whole chain it belongs to. */
export const get = teamQuery(null)({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const document = await visibleDocument(ctx, documentId);
    const rootId = document.chainRootId ?? document._id;
    const chain = await ctx.db
      .query('documents')
      .withIndex('by_chainRoot', (q) => q.eq('chainRootId', rootId))
      .collect();
    const root = rootId === document._id ? document : await ctx.db.get('documents', rootId);
    const inChain = [...(root && !chain.some((d) => d._id === root._id) ? [root] : []), ...chain];
    const versions = await ctx.db
      .query('documentVersions')
      .withIndex('by_document_version', (q) => q.eq('documentId', documentId))
      .order('desc')
      .collect();

    return {
      ...(await withNames(ctx, document)),
      // As the client will read it, what it still lacks, and the raw wording underneath for editing.
      ...(await reading(ctx, document)),
      rawBlocks: document.blocks,
      lineItems: document.lineItems,
      discount: document.discount,
      vat: document.vat,
      wht: document.wht,
      templateId: document.templateId,
      templateVersion: document.templateVersion,
      paymentScheduleSummary: document.paymentScheduleSummary,
      createdByName: (await ctx.db.get('teamMembers', document.createdByMemberId))?.name ?? 'Former member',
      chain: inChain
        .map((row) => ({
          id: row._id,
          type: row.type,
          typeLabel: TYPE_LABELS[row.type],
          title: row.title,
          number: row.number,
          status: row.status,
          createdAt: row._creationTime,
        }))
        .sort((a, b) => a.createdAt - b.createdAt),
      versions: versions.map((row) => ({
        version: row.version,
        createdAt: row.createdAt,
        changeNote: row.changeNote,
        hasPdf: row.pdfFileId !== undefined,
      })),
    };
  },
});

type CreateArgs = {
  type: typeof documentType.type;
  title?: string;
  clientId: Id<'clients'>;
  projectId?: Id<'projects'>;
  dealId?: Id<'deals'>;
  templateId?: Id<'documentTemplates'>;
  currency?: Currency;
  lineItems?: (typeof lineItemValidator.type)[];
  discount?: typeof discountValidator.type;
  validUntilDate?: string;
  paymentScheduleSummary?: string;
  contactId?: Id<'contacts'>;
  parentDocumentId?: Id<'documents'>;
};

/** Builds a draft: the template's blocks with the clause wording copied in and the variables filled. */
async function buildDocument(ctx: MutationCtx & Principal, args: CreateArgs) {
  const client = await getClient(ctx, args.clientId);
  const template = args.templateId
    ? await ctx.db.get('documentTemplates', args.templateId)
    : await defaultTemplateFor(ctx, args.type);
  if (args.templateId && !template) throw documentError('documents.notFound', 'Template not found');
  if (template && !template.active) throw documentError('documents.retired', 'That template is retired');
  if (!template) {
    // Without a template there is no wording, and an empty document is no use to anyone.
    throw documentError(
      'documents.noTemplate',
      `There is no active template for a ${TYPE_LABELS[args.type].toLowerCase()} yet. Add one first.`,
    );
  }

  const today = await studioToday(ctx);
  const settings = await getOrgSettings(ctx);
  const currency = args.currency ?? client.defaultCurrency ?? settings.defaultCurrency;
  const priced = PRICED_TYPES.has(args.type);
  const taxes = await taxSettingsFor(ctx, client);
  const discount = args.discount ?? { kind: 'none' as const };

  const priceable = priced
    ? documentTotals(checkedLineItems(args.lineItems ?? []), {
        discount: discount as Parameters<typeof documentTotals>[1]['discount'],
        ...taxes,
      })
    : null;

  const validUntilDate =
    args.type === 'quote' || args.type === 'proposal'
      ? (checkedDate(args.validUntilDate, 'The valid until date') ??
        addDays(today, settings.quoteValidityDays ?? DEFAULT_VALIDITY_DAYS))
      : checkedDate(args.validUntilDate, 'The valid until date');

  const [contact, project, deal] = await Promise.all([
    args.contactId ? ctx.db.get('contacts', args.contactId) : primaryContact(ctx, args.clientId),
    args.projectId ? ctx.db.get('projects', args.projectId) : null,
    args.dealId ? ctx.db.get('deals', args.dealId) : null,
  ]);
  if (project && project.clientId !== args.clientId) {
    throw documentError('documents.invalid', 'That project belongs to another client');
  }

  const title = text(args.title, 'Title', { max: 200 }) ?? `${TYPE_LABELS[args.type]} for ${client.displayName}`;
  // The clause wording is taken now; the variables wait until the document is read or sent, when its number exists.
  const blocks = await copyClausesIn(ctx, (template?.blocks ?? []) as DocumentBlock[]);
  void contact;
  void deal;

  return {
    fields: {
      type: args.type,
      title,
      clientId: args.clientId,
      projectId: args.projectId,
      dealId: args.dealId,
      templateId: template?._id,
      templateVersion: template?.version,
      status: 'draft' as const,
      currency,
      lineItems: priced ? priceable!.lineItems : undefined,
      discount: priced ? discount : undefined,
      vat: priced ? taxes.vat : undefined,
      wht: priced ? taxes.wht : undefined,
      totals: priced ? priceable!.totals : undefined,
      blocks,
      currentVersion: 0,
      parentDocumentId: args.parentDocumentId,
      validUntilDate,
      paymentScheduleSummary: text(args.paymentScheduleSummary, 'Payment schedule', { max: 300 }),
      viewCount: 0,
      createdByMemberId: ctx.principal.member._id,
    },
    client,
  };
}

/**
 * The document's wording with its variables filled in from the client, project, deal and totals it has now, and what it
 * is still missing. The number is assigned when it is first sent, so a draft is never short of one.
 */
async function reading(ctx: Ctx, document: Doc<'documents'>, contact?: Doc<'contacts'> | null) {
  const [client, primary, project, deal] = await Promise.all([
    ctx.db.get('clients', document.clientId),
    contact === undefined ? primaryContact(ctx, document.clientId) : contact,
    document.projectId ? ctx.db.get('projects', document.projectId) : null,
    document.dealId ? ctx.db.get('deals', document.dealId) : null,
  ]);
  if (!client) return { blocks: document.blocks, missing: [] };
  const values = await variableValues(
    ctx,
    document,
    { client, contact: primary, project, deal },
    await studioToday(ctx),
  );
  const missing = missingVariables(document.blocks, values).filter((name) => name !== 'document.number');
  return { blocks: fillBlocks(document.blocks, values), missing: describeMissing(missing, document) };
}

/** Refuses to send a document that would print a dash where a detail was promised. */
function assertNothingMissing(missing: MissingDetail[]) {
  if (missing.length === 0) return;
  throw documentError(
    'documents.missingDetails',
    `Fill these in before sending: ${missing.map((detail) => `${detail.label.toLowerCase()} (${detail.where})`).join('; ')}`,
  );
}

async function primaryContact(ctx: Ctx, clientId: Id<'clients'>) {
  const contacts = await ctx.db
    .query('contacts')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  const active = contacts.filter((contact) => contact.status === 'active');
  return active.find((contact) => contact.isPrimary) ?? active[0] ?? null;
}

export const create = teamMutation('documents.create')({
  args: {
    type: documentType,
    clientId: v.id('clients'),
    title: v.optional(v.string()),
    projectId: v.optional(v.id('projects')),
    dealId: v.optional(v.id('deals')),
    templateId: v.optional(v.id('documentTemplates')),
    currency: v.optional(v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'))),
    lineItems: v.optional(v.array(lineItemValidator)),
    discount: v.optional(discountValidator),
    validUntilDate: v.optional(v.string()),
    contactId: v.optional(v.id('contacts')),
  },
  handler: async (ctx, args) => {
    const { fields } = await buildDocument(ctx, args);
    const documentId = await ctx.db.insert('documents', fields);
    // A document with no parent is its own chain root.
    await ctx.db.patch('documents', documentId, { chainRootId: documentId });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: args.clientId },
      clientId: args.clientId,
      type: 'system',
      title: `${TYPE_LABELS[args.type]} drafted: ${fields.title}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { documentId },
    });
    return documentId;
  },
});

/** Quote → proposal → SOW → contract: the new document keeps the client, project, deal, prices and the chain. */
export const createFromParent = teamMutation('documents.create')({
  args: {
    parentDocumentId: v.id('documents'),
    type: documentType,
    title: v.optional(v.string()),
    templateId: v.optional(v.id('documentTemplates')),
    keepLineItems: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const parent = await visibleDocument(ctx, args.parentDocumentId);
    const keep = args.keepLineItems ?? true;
    const { fields } = await buildDocument(ctx, {
      type: args.type,
      title: args.title,
      clientId: parent.clientId,
      projectId: parent.projectId,
      dealId: parent.dealId,
      templateId: args.templateId,
      currency: parent.currency,
      lineItems: keep ? (parent.lineItems ?? []).map(({ amountMinor: _amount, ...item }) => item) : [],
      discount: parent.discount,
      paymentScheduleSummary: parent.paymentScheduleSummary,
      parentDocumentId: parent._id,
    });
    const documentId = await ctx.db.insert('documents', {
      ...fields,
      chainRootId: parent.chainRootId ?? parent._id,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: parent.clientId },
      clientId: parent.clientId,
      type: 'system',
      title: `${TYPE_LABELS[args.type]} drafted from ${parent.number ?? TYPE_LABELS[parent.type].toLowerCase()}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { documentId, parentDocumentId: parent._id },
    });
    return documentId;
  },
});

function assertEditable(document: Doc<'documents'>) {
  if (!EDITABLE_STATUSES.has(document.status)) {
    throw documentError(
      document.status === 'signed' ? 'documents.signed' : 'documents.notDraft',
      document.status === 'signed'
        ? 'A signed document cannot change. Raise a change request instead.'
        : `This document is ${document.status.replace('_', ' ')}. Editing it sends a new version, which arrives with sending.`,
    );
  }
}

export const update = teamMutation('documents.update')({
  args: {
    documentId: v.id('documents'),
    title: v.string(),
    lineItems: v.optional(v.array(lineItemValidator)),
    discount: v.optional(discountValidator),
    vat: v.optional(v.object({ applies: v.boolean(), bps: v.number() })),
    wht: v.optional(v.object({ applies: v.boolean(), bps: v.number() })),
    validUntilDate: v.optional(v.string()),
    paymentScheduleSummary: v.optional(v.string()),
    blocks: v.optional(v.array(blockValidator)),
  },
  handler: async (ctx, { documentId, ...args }) => {
    const document = await visibleDocument(ctx, documentId);
    assertEditable(document);
    const client = await getClient(ctx, document.clientId);
    const priced = PRICED_TYPES.has(document.type);
    const taxes = await taxSettingsFor(ctx, client);
    const discount = args.discount ?? document.discount ?? { kind: 'none' as const };
    const vat = args.vat ?? document.vat ?? taxes.vat;
    const wht = args.wht ?? document.wht ?? taxes.wht;
    const priceable = priced
      ? documentTotals(
          checkedLineItems(
            args.lineItems ?? (document.lineItems ?? []).map(({ amountMinor: _amount, ...item }) => item),
          ),
          { discount: discount as Parameters<typeof documentTotals>[1]['discount'], vat, wht },
        )
      : null;

    await ctx.db.patch('documents', documentId, {
      title: text(args.title, 'Title', { required: true, max: 200 })!,
      lineItems: priced ? priceable!.lineItems : undefined,
      discount: priced ? discount : undefined,
      vat: priced ? vat : undefined,
      wht: priced ? wht : undefined,
      totals: priced ? priceable!.totals : undefined,
      validUntilDate: checkedDate(args.validUntilDate, 'The valid until date'),
      paymentScheduleSummary: text(args.paymentScheduleSummary, 'Payment schedule', { max: 300 }),
      blocks: args.blocks ?? document.blocks,
    });
  },
});

/** Re-reads the client, project and totals into the text, for a draft edited after those changed. */
export const refreshText = teamMutation('documents.update')({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const document = await visibleDocument(ctx, documentId);
    assertEditable(document);
    const template = document.templateId ? await ctx.db.get('documentTemplates', document.templateId) : null;
    if (!template) {
      throw documentError(
        'documents.noTemplate',
        'This document has no template to rebuild from. Edit its wording here instead.',
      );
    }
    const [client, contact, project, deal] = await Promise.all([
      getClient(ctx, document.clientId),
      primaryContact(ctx, document.clientId),
      document.projectId ? ctx.db.get('projects', document.projectId) : null,
      document.dealId ? ctx.db.get('deals', document.dealId) : null,
    ]);
    void client;
    void contact;
    void project;
    void deal;
    await ctx.db.patch('documents', documentId, {
      blocks: await copyClausesIn(ctx, template.blocks as DocumentBlock[]),
      templateVersion: template.version,
    });
  },
});

/**
 * Records a decision the client gave outside the portal, until the portal itself can take it (12-client-portal.md).
 * The document keeps who recorded it, so an accepted document is never mistaken for one the client clicked.
 */
export const recordDecision = teamMutation('documents.send')({
  args: {
    documentId: v.id('documents'),
    decision: v.union(v.literal('accepted'), v.literal('declined')),
    contactId: v.optional(v.id('contacts')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { documentId, decision, contactId, note }) => {
    const document = await visibleDocument(ctx, documentId);
    if (!DECIDABLE_STATUSES.has(document.status)) {
      throw documentError(
        'documents.notWithClient',
        `Only a document that is with the client can be accepted or declined; this one is ${document.status}`,
      );
    }
    const reason = text(note, 'Note', { max: 1000 });
    if (decision === 'declined' && !reason) throw documentError('documents.needsReason', 'Say why it was declined');
    if (contactId) {
      const contact = await ctx.db.get('contacts', contactId);
      if (!contact || contact.clientId !== document.clientId) {
        throw documentError('documents.invalid', 'Choose a contact at this client');
      }
    }

    const now = Date.now();
    await ctx.db.patch('documents', documentId, {
      status: decision,
      acceptedAt: decision === 'accepted' ? now : undefined,
      acceptedByContactId: decision === 'accepted' ? contactId : undefined,
      declinedAt: decision === 'declined' ? now : undefined,
      declinedReason: decision === 'declined' ? reason : undefined,
      decisionRecordedByMemberId: ctx.principal.member._id,
      decisionNote: reason,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'status_change',
      title: `${document.number ?? TYPE_LABELS[document.type]} ${decision}, recorded by the studio`,
      body: reason,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { documentId, decision },
    });
  },
});

/** Voiding keeps the number and the record. A signed document is never voided. */
export const voidDocument = teamMutation('documents.void')({
  args: { documentId: v.id('documents'), reason: v.string() },
  handler: async (ctx, { documentId, reason }) => {
    const document = await visibleDocument(ctx, documentId);
    if (document.status === 'signed') {
      throw documentError('documents.signed', 'A signed document cannot be voided. Issue an amendment instead.');
    }
    if (document.status === 'void') return;
    await closeOpenRequests(ctx, documentId, 'cancelled');
    await ctx.db.patch('documents', documentId, {
      status: 'void',
      voidReason: text(reason, 'Reason', { required: true, max: 500 })!,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'status_change',
      title: `${document.number ?? TYPE_LABELS[document.type]} voided`,
      body: reason,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { documentId },
    });
  },
});

/** Deletes a draft that was never sent. Anything with a number stays on record. */
export const remove = teamMutation('documents.update')({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const document = await visibleDocument(ctx, documentId);
    if (document.number !== undefined || document.currentVersion > 0) {
      throw documentError('documents.sent', 'A document that has been sent stays on record. Void it instead.');
    }
    if (FINAL_STATUSES.has(document.status)) throw documentError('documents.sent', 'This document stays on record');
    const children = await ctx.db
      .query('documents')
      .withIndex('by_chainRoot', (q) => q.eq('chainRootId', document.chainRootId ?? documentId))
      .collect();
    if (children.some((child) => child.parentDocumentId === documentId)) {
      throw documentError('documents.hasChildren', 'Another document was made from this one');
    }
    await ctx.db.delete('documents', documentId);
  },
});

// Sending ---------------------------------------------------------------------------------------------------------------

/**
 * Sends the document to the client: checked here, then carried out by the action in convex/documentSending.ts, which
 * renders the PDF and emails it. Editing a sent document and sending again issues the next version.
 */
export const send = teamMutation('documents.send')({
  args: {
    documentId: v.id('documents'),
    contactIds: v.optional(v.array(v.id('contacts'))),
    message: v.optional(v.string()),
    changeNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const document = await visibleDocument(ctx, args.documentId);
    if (await hasOpenRequest(ctx, document._id)) {
      // A new version would no longer match the PDF the signers are signing.
      throw documentError('documents.signing', 'Cancel the signing request before sending a new version');
    }
    if (document.status === 'signed' || document.status === 'void') {
      throw documentError(
        document.status === 'signed' ? 'documents.signed' : 'documents.void',
        `A ${document.status} document cannot be sent again`,
      );
    }
    // Checked before scheduling, so an impossible send is refused while the person is still looking at it.
    const recipients = await sendRecipients(ctx, document.clientId, args.contactIds);
    if (recipients.length === 0) {
      throw documentError('documents.noRecipients', 'Add a contact with an email address to send this to');
    }
    // Filled as the send will fill it: addressed to the first person it goes to.
    assertNothingMissing((await reading(ctx, document, await ctx.db.get('contacts', recipients[0].id))).missing);
    await ctx.scheduler.runAfter(0, internal.documentSending.send, {
      documentId: args.documentId,
      memberId: ctx.principal.member._id,
      contactIds: args.contactIds,
      message: text(args.message, 'Message', { max: 2000 }),
      changeNote: text(args.changeNote, 'Change note', { max: 500 }),
    });
    return { sendingTo: recipients.map((recipient) => recipient.email) };
  },
});

/** Tells whoever pressed send that it did not go out, with the reason, so nothing fails silently. */
export const reportSendFailed = internalMutation({
  args: { documentId: v.id('documents'), memberId: v.id('teamMembers'), reason: v.string() },
  handler: async (ctx, { documentId, memberId, reason }): Promise<null> => {
    const document = await ctx.db.get('documents', documentId);
    const member = await ctx.db.get('teamMembers', memberId);
    if (!document || member?.status !== 'active') return null;
    await notifyTeamMembers(ctx, [member._id], {
      event: 'document_send_failed',
      title: `${document.number ?? TYPE_LABELS[document.type]} was not sent`,
      body: reason,
      link: `/documents/${documentId}`,
    });
    return null;
  },
});

/**
 * The first half of a send: the version is snapshotted and the number assigned here, in one transaction, and the PDF is
 * rendered afterwards by the action in convex/documentSending.ts. Editing a sent document sends the next version, and
 * the previous one stays readable.
 */
export const prepareSend = internalMutation({
  args: {
    documentId: v.id('documents'),
    contactIds: v.optional(v.array(v.id('contacts'))),
    changeNote: v.optional(v.string()),
    memberId: v.id('teamMembers'),
  },
  handler: async (ctx, args): Promise<PreparedSend> => {
    const document = await getDocument(ctx, args.documentId);
    if (await hasOpenRequest(ctx, document._id)) {
      // A new version would no longer match the PDF the signers are signing.
      throw documentError('documents.signing', 'Cancel the signing request before sending a new version');
    }
    if (document.status === 'signed' || document.status === 'void') {
      throw documentError(
        document.status === 'signed' ? 'documents.signed' : 'documents.void',
        `A ${document.status} document cannot be sent again`,
      );
    }
    const client = await getClient(ctx, document.clientId);

    const recipients = await sendRecipients(ctx, document.clientId, args.contactIds);
    if (recipients.length === 0) {
      throw documentError('documents.noRecipients', 'Add a contact with an email address to send this to');
    }

    const number = document.number ?? (await nextNumber(ctx, numberedRecordFor(document.type)));
    const now = Date.now();
    const changeNote = text(args.changeNote, 'Change note', { max: 500 });

    // Filled now, with the number the document is about to carry: this is exactly what the client will read.
    const [contact, project, deal] = await Promise.all([
      ctx.db.get('contacts', recipients[0].id),
      document.projectId ? ctx.db.get('projects', document.projectId) : null,
      document.dealId ? ctx.db.get('deals', document.dealId) : null,
    ]);
    const values = await variableValues(
      ctx,
      { ...document, number },
      { client, contact, project, deal },
      await studioToday(ctx),
    );
    // Checked again here: a detail may have been cleared between pressing send and this running.
    assertNothingMissing(describeMissing(missingVariables(document.blocks, values), document));
    const readable = fillBlocks(document.blocks, values);

    const latest = await ctx.db
      .query('documentVersions')
      .withIndex('by_document_version', (q) => q.eq('documentId', document._id))
      .order('desc')
      .first();
    const unfinished = latest?.version === document.currentVersion && latest.pdfFileId === undefined ? latest : null;
    const version = unfinished ? unfinished.version : document.currentVersion + 1;

    if (unfinished) {
      await ctx.db.patch('documentVersions', unfinished._id, {
        blocks: readable,
        lineItems: document.lineItems,
        totals: document.totals,
        createdAt: now,
        createdBy: args.memberId,
        changeNote,
      });
    } else {
      await ctx.db.insert('documentVersions', {
        documentId: document._id,
        version,
        blocks: readable,
        lineItems: document.lineItems,
        totals: document.totals,
        createdAt: now,
        createdBy: args.memberId,
        changeNote,
      });
    }
    await ctx.db.patch('documents', document._id, { number, currentVersion: version });

    const settings = await getOrgSettings(ctx);
    const milestones = document.projectId
      ? await ctx.db
          .query('milestones')
          .withIndex('by_project_order', (q) => q.eq('projectId', document.projectId!))
          .collect()
      : [];
    const currency = document.currency ?? settings.defaultCurrency;
    const longDate = (value: string | undefined) =>
      value
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
            Date.parse(`${value}T00:00:00Z`),
          )
        : undefined;

    const sender = await ctx.db.get('teamMembers', args.memberId);

    return {
      version,
      number,
      title: document.title,
      typeLabel: TYPE_LABELS[document.type],
      senderName: sender?.name ?? 'Unbuilt Studio',
      studioName: settings.legalName ?? settings.tradingName ?? 'Unbuilt Studio',
      validUntilLabel: longDate(document.validUntilDate),
      portalUrl: `${portalAppOrigin() ?? ''}/documents/${document._id}`,
      recipients,
      pdf: {
        blocks: readable,
        title: document.title,
        typeLabel: TYPE_LABELS[document.type],
        number,
        org: {
          name: settings.legalName ?? settings.tradingName ?? 'Unbuilt Studio',
          addressLines: settings.addressLines,
          email: settings.email,
          phone: settings.phone,
          website: settings.website,
          tin: settings.tin,
        },
        client: { name: client.legalName ?? client.displayName, addressLines: client.addressLines ?? [] },
        currency,
        lineItems: document.lineItems,
        totals: document.totals,
        milestones: milestones.map((milestone) => ({ name: milestone.name, dueDate: longDate(milestone.dueDate) })),
        paymentSchedule: [],
        voided: false,
        brand: settings.brand,
        // The version's own time, so re-rendering the same version gives the same bytes.
        createdAtMs: now,
      },
    };
  },
});

/** The stored PDF, checked and recorded like any other upload, then attached to the document and its version. */
export const attachPdf = internalMutation({
  args: {
    documentId: v.id('documents'),
    version: v.number(),
    storageId: v.id('_storage'),
    fileName: v.string(),
    memberId: v.id('teamMembers'),
  },
  handler: async (ctx, args): Promise<AttachedPdf> => {
    const document = await getDocument(ctx, args.documentId);
    const result = await recordUpload(ctx, {
      storageId: args.storageId,
      name: args.fileName,
      contentType: 'application/pdf',
      context: 'document',
      owner: { table: 'documents', id: args.documentId },
      // The client reads it in the portal.
      visibility: 'client',
      clientId: document.clientId,
      projectId: document.projectId,
      uploadedBy: { kind: 'team', id: args.memberId },
    });
    if (!result.ok) return result;

    const file = (await ctx.db.get('files', result.fileId))!;
    const versionRow = await ctx.db
      .query('documentVersions')
      .withIndex('by_document_version', (q) => q.eq('documentId', args.documentId).eq('version', args.version))
      .unique();
    if (versionRow) {
      await ctx.db.patch('documentVersions', versionRow._id, { pdfFileId: file._id, pdfSha256: file.sha256 });
    }
    await ctx.db.patch('documents', args.documentId, { pdfFileId: file._id, pdfSha256: file.sha256 });
    return { ok: true as const, fileId: file._id, sha256: file.sha256 };
  },
});

/** The document is sent once the client has been emailed, so a failed send never shows as one. */
export const markSent = internalMutation({
  args: { documentId: v.id('documents'), version: v.number(), emailed: v.array(v.string()) },
  handler: async (ctx, { documentId, version, emailed }): Promise<null> => {
    const document = await getDocument(ctx, documentId);
    const now = Date.now();
    await ctx.db.patch('documents', documentId, {
      status: SIGNED_TYPES.has(document.type) ? 'awaiting_signature' : 'sent',
      sentAt: document.sentAt ?? now,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: document.clientId },
      clientId: document.clientId,
      type: 'system',
      title: `${document.number} sent to ${emailed.join(', ')}`,
      body: version > 1 ? `Version ${version}` : undefined,
      actor: { kind: 'team', id: document.createdByMemberId },
      meta: { documentId, version },
    });
    return null;
  },
});

/** Who a document goes to: the contacts chosen, or the primary contact when none are. */
async function sendRecipients(ctx: MutationCtx, clientId: Id<'clients'>, contactIds?: Id<'contacts'>[]) {
  const contacts = await ctx.db
    .query('contacts')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  const active = contacts.filter((contact) => contact.status === 'active');
  const chosen = contactIds?.length
    ? active.filter((contact) => contactIds.includes(contact._id))
    : active.filter((contact) => contact.isPrimary).slice(0, 1);
  if (contactIds?.length && chosen.length !== contactIds.length) {
    throw documentError('documents.invalid', 'Choose active contacts at this client');
  }
  return chosen.map((contact) => ({ id: contact._id, name: contact.name, email: contact.email }));
}

/**
 * Records that someone opened a document. A team member's look is recorded but never counts as the client seeing it
 * (07-documents-and-esign.md, View tracking); the portal's own view arrives with the client portal step.
 */
export const logTeamView = teamMutation(null)({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const document = await visibleDocument(ctx, documentId);
    await ctx.db.insert('documentViews', {
      documentId,
      version: document.currentVersion,
      viewerKind: 'member',
      viewerId: ctx.principal.member._id,
      viewedAt: Date.now(),
    });
  },
});

/** A client's view: the first one moves a sent document to viewed and tells whoever drafted it. */
export const recordClientView = internalMutation({
  args: {
    documentId: v.id('documents'),
    contactId: v.optional(v.id('contacts')),
    viewerKind: v.union(v.literal('contact'), v.literal('token')),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await recordClientViewOf(ctx, args);
  },
});

/** Quotes and proposals past their date become expired, and their owner is told once (a daily cron). */
export const expireOverdue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = await studioToday(ctx);
    const open = [
      ...(await ctx.db
        .query('documents')
        .withIndex('by_status', (q) => q.eq('status', 'sent'))
        .collect()),
      ...(await ctx.db
        .query('documents')
        .withIndex('by_status', (q) => q.eq('status', 'viewed'))
        .collect()),
    ];
    const expired = open.filter(
      (document) =>
        (document.type === 'quote' || document.type === 'proposal') &&
        document.validUntilDate !== undefined &&
        document.validUntilDate < today,
    );
    for (const document of expired) {
      await ctx.db.patch('documents', document._id, { status: 'expired' });
      const owner = await ctx.db.get('teamMembers', document.createdByMemberId);
      const recipients =
        owner?.status === 'active' ? [owner._id] : await activeMembersWith(ctx, 'documents.send' as const);
      await notifyTeamMembers(ctx, recipients, {
        event: 'document_expired',
        title: `${document.number ?? TYPE_LABELS[document.type]} has expired`,
        body: document.title,
        link: `/documents/${document._id}`,
      });
    }
    return { expired: expired.length };
  },
});
