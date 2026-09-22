import { type DocumentType, TYPE_LABELS } from '@/convex/lib/documentBlocks';
import { InputError } from '@/lib/convex-error';
import { type StatusTone } from '@/lib/team-display';

// How documents are shown (07-documents-and-esign.md, Lifecycle). The words are the ones the studio would say out loud:
// "with the client" rather than "sent", "waiting to be signed" rather than "awaiting_signature".

export type DocumentStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'awaiting_signature'
  | 'partially_signed'
  | 'signed'
  | 'void';

export const DOCUMENT_STATUSES: DocumentStatus[] = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'awaiting_signature',
  'partially_signed',
  'signed',
  'void',
];

export function documentStatus(status: DocumentStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'draft':
      return { label: 'Draft', tone: 'draft' };
    case 'sent':
      return { label: 'With the client', tone: 'draft' };
    case 'viewed':
      return { label: 'Opened by the client', tone: 'draft' };
    case 'accepted':
      return { label: 'Accepted', tone: 'built' };
    case 'declined':
      return { label: 'Declined', tone: 'attention' };
    case 'expired':
      return { label: 'Expired', tone: 'attention' };
    case 'awaiting_signature':
      return { label: 'Waiting to be signed', tone: 'attention' };
    case 'partially_signed':
      return { label: 'Part signed', tone: 'attention' };
    case 'signed':
      return { label: 'Signed', tone: 'built' };
    case 'void':
      return { label: 'Void', tone: 'muted' };
  }
}

export { TYPE_LABELS as DOCUMENT_TYPE_LABELS };

/** The types someone can start from scratch. Handovers and team agreements come from their own flows later. */
export const CREATABLE_TYPES: DocumentType[] = [
  'quote',
  'proposal',
  'sow',
  'contract',
  'sla',
  'nda',
  'dpa',
  'change_request',
  'other',
];

/** What a document of this type can become next, so the page can offer the next step in the chain. */
export const NEXT_IN_CHAIN: Partial<Record<DocumentType, DocumentType[]>> = {
  quote: ['proposal', 'sow'],
  proposal: ['sow', 'contract'],
  sow: ['contract', 'change_request'],
  contract: ['sow'],
};

/** Quantities are stored in thousandths: 1500 → "1.5". */
export function formatQuantity(quantityMilli: number): string {
  const value = quantityMilli / 1000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** A typed quantity as thousandths: "1.5" → 1500. Refuses anything that is not a positive number. */
export function parseQuantity(value: string): number {
  const quantity = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0) throw new InputError('Give the quantity as a number above zero');
  return Math.round(quantity * 1000);
}
