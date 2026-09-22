import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type Currency, calculateTotals, type Discount, formatMoney, type LineInput, type TaxSetting } from './money';
import { type DocumentPdfPayload } from '../../pdf/types';
import {
  type DocumentBlock,
  documentError,
  type DocumentType,
  fillVariables,
  TYPE_LABELS,
  VARIABLES,
} from './documentBlocks';
import { notifyTeamMembers } from './notify';
import { type NumberedRecord } from './numbering';
import { requirePermission } from './crm';
import { type TeamPrincipal } from './principals';
import { inProjectScope } from './projects';
import { getOrgSettings } from './settings';

export { TYPE_LABELS };

// Building a document (07-documents-and-esign.md). A document is created from a template, and from that moment it owns
// its text: clause wording is copied in and variables are filled, so editing the template or the clause later changes
// nothing here.

/**
 * What a send needs after its version is snapshotted. Named here, rather than inferred, so the action in
 * convex/documentSending.ts does not have to infer it back through convex/_generated/api.d.ts: that circle overwhelms
 * TypeScript and every api.* result silently loses its type.
 */
export type PreparedSend = {
  version: number;
  number: string;
  title: string;
  typeLabel: string;
  senderName: string;
  studioName: string;
  validUntilLabel?: string;
  portalUrl: string;
  recipients: { id: Id<'contacts'>; name: string; email: string }[];
  pdf: DocumentPdfPayload;
};

export type AttachedPdf =
  { ok: true; fileId: Id<'files'>; sha256: string } | { ok: false; code: string; message: string };

export type LineItem = {
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  amountMinor: number;
  rateCardItemId?: Id<'rateCardItems'>;
  taxable: boolean;
};

/** Statuses a draft may still be edited in. Everything else is either with the client or final. */
/**
 * Statuses whose working copy can be edited: a draft, or a document with the client that nobody has decided on or signed.
 * Editing a sent one prepares its next version; the client keeps the last one sent until that goes out. A running
 * signing request also blocks editing (checked separately), since its signers hold a locked version.
 */
export const EDITABLE_STATUSES: ReadonlySet<Doc<'documents'>['status']> = new Set([
  'draft',
  'sent',
  'viewed',
  'expired',
  'awaiting_signature',
]);

/** A document the client has decided on, or that is signed, is closed to changes of any kind. */
export const FINAL_STATUSES: ReadonlySet<Doc<'documents'>['status']> = new Set(['signed', 'void']);

export const DECIDABLE_STATUSES: ReadonlySet<Doc<'documents'>['status']> = new Set(['sent', 'viewed']);

const NUMBERED: Record<DocumentType, NumberedRecord> = {
  quote: 'quote',
  proposal: 'proposal',
  sow: 'sow',
  contract: 'contract',
  sla: 'sla',
  nda: 'nda',
  dpa: 'dpa',
  change_request: 'changeRequest',
  handover: 'handover',
  team_agreement: 'teamAgreement',
  other: 'document',
};

/** Which counter a document's number comes from, so each type runs its own sequence. */
export const numberedRecordFor = (type: DocumentType): NumberedRecord => NUMBERED[type];

export async function getDocument(ctx: QueryCtx | MutationCtx, documentId: Id<'documents'>) {
  const document = await ctx.db.get('documents', documentId);
  if (!document) throw documentError('documents.notFound', 'Document not found');
  return document;
}

/** Totals for a priced document, from the client's own VAT and WHT settings unless the document overrides them. */
export function documentTotals(
  lineItems: LineItem[],
  { discount, vat, wht }: { discount: Discount; vat: TaxSetting; wht: TaxSetting },
) {
  const lines: LineInput[] = lineItems.map((item) => ({
    quantityMilli: item.quantityMilli,
    unitPriceMinor: item.unitPriceMinor,
    taxable: item.taxable,
  }));
  const { lineAmountsMinor, totals } = calculateTotals({ lines, discount, vat, wht });
  return { lineItems: lineItems.map((item, index) => ({ ...item, amountMinor: lineAmountsMinor[index] })), totals };
}

/** VAT and WHT as they apply to this client, before any override on the document itself. */
export async function taxSettingsFor(ctx: QueryCtx | MutationCtx, client: Doc<'clients'>) {
  const settings = await getOrgSettings(ctx);
  return {
    vat: { applies: client.vatTreatment === 'standard', bps: settings.defaultVatBps },
    wht: { applies: client.whtApplies === true, bps: client.whtBps ?? 0 },
  };
}

const date = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed)
    ? undefined
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(parsed);
};

/** Everything a template's variables can be filled from. Values the document does not have are left blank. */
export async function variableValues(
  ctx: QueryCtx | MutationCtx,
  document: {
    type: DocumentType;
    title: string;
    number?: string;
    validUntilDate?: string;
    currency?: Currency;
    totals?: Doc<'documents'>['totals'];
    sentAt?: number;
    paymentScheduleSummary?: string;
  },
  refs: {
    client: Doc<'clients'>;
    contact?: Doc<'contacts'> | null;
    project?: Doc<'projects'> | null;
    deal?: Doc<'deals'> | null;
  },
  today: string,
): Promise<Record<string, string | undefined>> {
  const org = await getOrgSettings(ctx);
  const currency = document.currency ?? org.defaultCurrency;
  const money = (amountMinor: number | undefined) =>
    amountMinor === undefined ? undefined : formatMoney(amountMinor, currency);

  return {
    'client.displayName': refs.client.displayName,
    'client.legalName': refs.client.legalName ?? refs.client.displayName,
    'client.address': refs.client.addressLines?.join(', '),
    'client.country': refs.client.country,
    'client.tin': refs.client.tin,
    'contact.name': refs.contact?.name,
    'contact.email': refs.contact?.email,
    'contact.jobTitle': refs.contact?.jobTitle,
    'project.name': refs.project?.name,
    'project.code': refs.project?.code,
    'project.startDate': date(refs.project?.startDate),
    'project.dueDate': date(refs.project?.dueDate),
    'deal.title': refs.deal?.title,
    'org.legalName': org.legalName,
    'org.address': org.addressLines.join(', ') || undefined,
    'org.tin': org.tin,
    'org.vatNumber': org.vatNumber,
    'org.email': org.email,
    'org.phone': org.phone,
    'org.website': org.website,
    'document.number': document.number,
    'document.title': document.title,
    'document.type': TYPE_LABELS[document.type],
    'document.date': date(today),
    today: date(today),
    validUntil: date(document.validUntilDate),
    'totals.subtotal': money(document.totals?.subtotalMinor),
    'totals.vat': money(document.totals?.vatMinor),
    'totals.wht': money(document.totals?.whtExpectedMinor),
    'totals.total': money(document.totals?.totalMinor),
    'totals.currency': currency,
    // Written on the draft for now; billing schedules will fill it once they exist.
    'schedule.summary': document.paymentScheduleSummary,
  };
}

/**
 * The document's own copy of the wording: each clause replaced by the text it has right now, so editing the clause
 * afterwards changes nothing here. Variables are left as they are; they are filled when the document is shown or sent,
 * by which time the number, the date and the totals exist.
 */
export async function copyClausesIn(ctx: QueryCtx | MutationCtx, blocks: DocumentBlock[]): Promise<DocumentBlock[]> {
  const copied: DocumentBlock[] = [];
  for (const block of blocks) {
    if (block.kind === 'clause') {
      const clause = await ctx.db
        .query('clauses')
        .withIndex('by_key', (q) => q.eq('key', block.clauseKey))
        .unique();
      if (!clause) throw documentError('documents.clauseMissing', `There is no clause called "${block.clauseKey}"`);
      copied.push({ kind: 'heading', text: clause.title, level: 3 });
      copied.push({ kind: 'paragraph', text: clause.body });
      continue;
    }
    copied.push(block);
  }
  return copied;
}

/** The same blocks with every variable filled in, as the client will read them. */
export function fillBlocks(blocks: DocumentBlock[], values: Record<string, string | undefined>): DocumentBlock[] {
  return blocks.map((block) =>
    block.kind === 'heading' || block.kind === 'paragraph'
      ? { ...block, text: fillVariables(block.text, values) }
      : block,
  );
}

export type MissingDetail = {
  /** What is missing, in words, such as "The studio’s registered name". */
  label: string;
  /** How to put it right, in a sentence. */
  where: string;
  /** A page to put it right on, when there is one. */
  href?: string;
  /** A fix the document page can offer in place: link a deal or project, or write the payment schedule. */
  fix?: 'linkDeal' | 'linkProject' | 'paymentSchedule';
};

/** Says, for each missing variable, what it is and how to put it right, in the studio's own words. */
export function describeMissing(
  names: string[],
  document: { _id: Id<'documents'>; clientId: Id<'clients'>; projectId?: Id<'projects'>; dealId?: Id<'deals'> },
): MissingDetail[] {
  return names.map((name): MissingDetail => {
    const label = VARIABLES[name] ?? name;
    const placeholder = `{{${name}}}`;
    if (name.startsWith('org.')) {
      return { label, where: 'Add it in Settings → Organisation.', href: '/settings/organisation' };
    }
    if (name.startsWith('client.')) {
      return { label, where: 'Add it on the client’s page.', href: `/crm/clients/${document.clientId}` };
    }
    if (name.startsWith('contact.')) {
      return {
        label,
        where: 'Add it to the contact, on the client’s page.',
        href: `/crm/clients/${document.clientId}`,
      };
    }
    if (name.startsWith('project.')) {
      return document.projectId
        ? { label, where: 'Add it on the project.', href: `/projects/${document.projectId}` }
        : {
            label,
            where: `This document is not linked to a project. Link one, or remove ${placeholder} from the wording.`,
            fix: 'linkProject',
          };
    }
    if (name.startsWith('deal.')) {
      return document.dealId
        ? { label, where: 'Add it on the deal.', href: `/crm/deals/${document.dealId}` }
        : {
            label,
            where: `This document is not linked to a deal. Link one, or remove ${placeholder} from the wording.`,
            fix: 'linkDeal',
          };
    }
    if (name === 'validUntil') return { label, where: 'Set the date it is open until, in the draft.' };
    if (name === 'schedule.summary') {
      return { label, where: 'Write it as it should read in the document.', fix: 'paymentSchedule' };
    }
    return { label, where: `Edit the draft, or remove ${placeholder} from the wording.` };
  });
}

/**
 * Who may see a document. Anyone with documents.view sees them all; documents.view.assigned reaches the ones on a
 * project the caller belongs to. A document outside that scope is "not found", as everywhere else.
 */
export async function visibleDocument(
  ctx: (QueryCtx | MutationCtx) & { principal: TeamPrincipal },
  documentId: Id<'documents'>,
) {
  const document = await getDocument(ctx, documentId);
  if (ctx.principal.permissions.has('documents.view')) return document;
  requirePermission(ctx.principal, 'documents.view.assigned');
  const inScope = document.projectId ? await inProjectScope(ctx, ctx.principal, document.projectId) : false;
  if (!inScope) throw documentError('documents.notFound', 'Document not found');
  return document;
}

/**
 * A client's look at a document, through the portal or a signing link. The first one moves a sent document to viewed
 * and tells whoever drafted it, once; later ones only raise the count.
 */
export async function recordClientViewOf(
  ctx: { db: MutationCtx['db'] },
  args: {
    documentId: Id<'documents'>;
    contactId?: Id<'contacts'>;
    viewerKind: 'contact' | 'token';
    ip?: string;
    userAgent?: string;
  },
) {
  const document = await ctx.db.get('documents', args.documentId);
  if (!document) throw documentError('documents.notFound', 'Document not found');
  const now = Date.now();
  await ctx.db.insert('documentViews', {
    documentId: args.documentId,
    version: document.currentVersion,
    viewerKind: args.viewerKind,
    viewerId: args.contactId,
    ip: args.ip,
    userAgent: args.userAgent,
    viewedAt: now,
  });
  const first = document.firstViewedAt === undefined;
  await ctx.db.patch('documents', args.documentId, {
    status: document.status === 'sent' ? 'viewed' : document.status,
    firstViewedAt: document.firstViewedAt ?? now,
    lastViewedAt: now,
    viewCount: document.viewCount + 1,
  });
  if (first) {
    const owner = await ctx.db.get('teamMembers', document.createdByMemberId);
    if (owner?.status === 'active') {
      await notifyTeamMembers(ctx, [owner._id], {
        event: 'document_viewed',
        title: `${document.number ?? TYPE_LABELS[document.type]} was opened by the client`,
        body: document.title,
        link: `/documents/${document._id}`,
      });
    }
  }
}
