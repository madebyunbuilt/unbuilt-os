import { ConvexError, v } from 'convex/values';

// Document blocks and their variables (07-documents-and-esign.md, Templates and clauses). A template is an ordered list
// of blocks; a document snapshots the resolved blocks so later edits to the template or its clauses never change it.

export function documentError(code: `documents.${string}`, message: string) {
  return new ConvexError({ code, message });
}

export const blockValidator = v.union(
  v.object({ kind: v.literal('heading'), text: v.string(), level: v.optional(v.number()) }),
  v.object({ kind: v.literal('paragraph'), text: v.string() }),
  // The clause's text is copied into the document when it is created, from the version current at that moment.
  v.object({ kind: v.literal('clause'), clauseKey: v.string(), clauseVersion: v.optional(v.number()) }),
  v.object({ kind: v.literal('lineItems'), title: v.optional(v.string()) }),
  v.object({ kind: v.literal('totals') }),
  v.object({ kind: v.literal('milestones'), title: v.optional(v.string()) }),
  v.object({ kind: v.literal('paymentSchedule'), title: v.optional(v.string()) }),
  v.object({ kind: v.literal('signature'), party: v.union(v.literal('client'), v.literal('studio')) }),
  v.object({ kind: v.literal('pageBreak') }),
  v.object({ kind: v.literal('image'), fileId: v.optional(v.id('files')), alt: v.string() }),
);

export type DocumentBlock = typeof blockValidator.type;

export const documentType = v.union(
  v.literal('quote'),
  v.literal('proposal'),
  v.literal('sow'),
  v.literal('contract'),
  v.literal('sla'),
  v.literal('nda'),
  v.literal('dpa'),
  v.literal('change_request'),
  v.literal('handover'),
  v.literal('team_agreement'),
  v.literal('other'),
);

export type DocumentType = typeof documentType.type;

/** Which types carry prices, so a template without line items and totals can be refused where it matters. */
export const PRICED_TYPES: ReadonlySet<DocumentType> = new Set(['quote', 'proposal', 'sow', 'change_request']);

/** Types signed by default. SLA and change requests are decided per document (06-projects.md, Change requests). */
export const SIGNED_TYPES: ReadonlySet<DocumentType> = new Set([
  'sow',
  'contract',
  'nda',
  'dpa',
  'handover',
  'team_agreement',
]);

/** Types whose wording a lawyer should approve before the studio sends them. */
export const LEGAL_REVIEW_TYPES: ReadonlySet<DocumentType> = new Set(['contract', 'nda', 'dpa', 'team_agreement']);

/**
 * Every variable a template may use, with what it means. A template that names anything else is refused when it is
 * saved, so a document can never be sent with "{{clietn.name}}" printed on it.
 */
export const VARIABLES: Record<string, string> = {
  'client.displayName': 'The client’s name as the studio uses it',
  'client.legalName': 'The client’s registered name',
  'client.address': 'The client’s address, on one line',
  'client.country': 'The client’s country',
  'client.tin': 'The client’s tax identification number',
  'contact.name': 'The contact this document is addressed to',
  'contact.email': 'That contact’s email address',
  'contact.jobTitle': 'That contact’s job title',
  'project.name': 'The project’s name',
  'project.code': 'The project’s code, such as UNB-P-0007',
  'project.startDate': 'The project’s start date',
  'project.dueDate': 'The project’s due date',
  'deal.title': 'The deal this came from',
  'org.legalName': 'The studio’s registered name',
  'org.address': 'The studio’s address, on one line',
  'org.tin': 'The studio’s tax identification number',
  'org.vatNumber': 'The studio’s VAT number',
  'document.number': 'The document’s number, assigned when it is first sent',
  'document.title': 'The document’s title',
  'document.type': 'The kind of document, in words',
  'document.date': 'The date the document was sent',
  today: 'Today’s date',
  validUntil: 'The date a quote or proposal expires',
  'totals.subtotal': 'The total before tax',
  'totals.vat': 'VAT',
  'totals.wht': 'Withholding tax',
  'totals.total': 'The amount payable',
  'totals.currency': 'The currency of the amounts',
  'schedule.summary': 'The payment schedule in words, such as "50% on signature, 50% on completion"',
};

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

/** Every variable named in a piece of text, in the order they appear, without duplicates. */
export function variablesIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(VARIABLE_PATTERN), (match) => match[1]))];
}

/** Every variable a set of blocks uses. Clause bodies are checked when the clause itself is saved. */
export function variablesInBlocks(blocks: DocumentBlock[]): string[] {
  const found = blocks.flatMap((block) =>
    block.kind === 'heading' || block.kind === 'paragraph' ? variablesIn(block.text) : [],
  );
  return [...new Set(found)];
}

/** Refuses text naming a variable the app cannot fill in. */
export function assertKnownVariables(text: string, where: string): void {
  const unknown = variablesIn(text).filter((name) => !(name in VARIABLES));
  if (unknown.length > 0) {
    throw documentError(
      'documents.unknownVariable',
      `${where} uses ${unknown.map((name) => `{{${name}}}`).join(', ')}, which the app cannot fill in`,
    );
  }
}

/** Replaces every variable with its value. A value the document does not have is left visibly blank. */
export function fillVariables(text: string, values: Record<string, string | undefined>): string {
  return text.replace(VARIABLE_PATTERN, (_, name: string) => values[name] ?? '—');
}
