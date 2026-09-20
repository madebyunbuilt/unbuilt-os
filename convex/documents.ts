import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { defaultTemplateFor } from './documentTemplates';
import { getClient, recordActivity, requirePermission, text } from './lib/crm';
import { blockValidator, type DocumentBlock, documentError, documentType, PRICED_TYPES } from './lib/documentBlocks';
import {
  DECIDABLE_STATUSES,
  documentTotals,
  EDITABLE_STATUSES,
  FINAL_STATUSES,
  getDocument,
  type LineItem,
  resolveBlocks,
  taxSettingsFor,
  TYPE_LABELS,
  variableValues,
} from './lib/documents';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { type Currency } from './lib/money';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { type TeamPrincipal } from './lib/principals';
import { inProjectScope } from './lib/projects';
import { getOrgSettings } from './lib/settings';
import { localDateString } from './lib/businessTime';
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

/**
 * Who may see a document. Anyone with documents.view sees them all; documents.view.assigned reaches the ones on a
 * project the caller belongs to. A document outside that scope is "not found", as everywhere else.
 */
async function visibleDocument(ctx: Ctx & Principal, documentId: Id<'documents'>) {
  const document = await getDocument(ctx, documentId);
  if (ctx.principal.permissions.has('documents.view')) return document;
  requirePermission(ctx.principal, 'documents.view.assigned');
  const inScope = document.projectId ? await inProjectScope(ctx, ctx.principal, document.projectId) : false;
  if (!inScope) throw documentError('documents.notFound', 'Document not found');
  return document;
}

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
      blocks: document.blocks,
      lineItems: document.lineItems,
      discount: document.discount,
      vat: document.vat,
      wht: document.wht,
      templateId: document.templateId,
      templateVersion: document.templateVersion,
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
  const values = await variableValues(
    ctx,
    { type: args.type, title, validUntilDate, currency, totals: priceable?.totals },
    { client, contact, project, deal },
    today,
  );
  const blocks = await resolveBlocks(ctx, (template?.blocks ?? []) as DocumentBlock[], values);

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
      viewCount: 0,
      createdByMemberId: ctx.principal.member._id,
    },
    client,
  };
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
    if (!template) throw documentError('documents.noTemplate', 'This document was not made from a template');
    const [client, contact, project, deal] = await Promise.all([
      getClient(ctx, document.clientId),
      primaryContact(ctx, document.clientId),
      document.projectId ? ctx.db.get('projects', document.projectId) : null,
      document.dealId ? ctx.db.get('deals', document.dealId) : null,
    ]);
    const values = await variableValues(ctx, document, { client, contact, project, deal }, await studioToday(ctx));
    await ctx.db.patch('documents', documentId, {
      blocks: await resolveBlocks(ctx, template.blocks as DocumentBlock[], values),
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
