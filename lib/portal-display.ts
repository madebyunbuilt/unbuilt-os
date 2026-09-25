import { type StatusTone } from '@/lib/team-display';

// How a client's own work is described to them (12-client-portal.md). The studio's internal words are not always the
// client's: "invoiced" is the studio's business, so an invoiced milestone simply reads as done.

export function projectStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'planning':
      return { label: 'Getting started', tone: 'draft' };
    case 'active':
      return { label: 'Under way', tone: 'built' };
    case 'on_hold':
      return { label: 'On hold', tone: 'attention' };
    case 'completed':
      return { label: 'Finished', tone: 'built' };
    default:
      return { label: 'Under way', tone: 'draft' };
  }
}

export function milestoneStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'upcoming':
      return { label: 'To come', tone: 'draft' };
    case 'in_progress':
      return { label: 'In progress', tone: 'draft' };
    case 'awaiting_approval':
      return { label: 'Waiting for you', tone: 'attention' };
    case 'approved':
    case 'invoiced':
      return { label: 'Done', tone: 'built' };
    case 'skipped':
      return { label: 'Not needed', tone: 'muted' };
    default:
      return { label: 'To come', tone: 'draft' };
  }
}

/**
 * Where a signed document stands for the person reading it. `awaiting_signature` on its own means only that the
 * document went out, so the label comes from whether a signing request exists and who it names.
 */
export type PortalSigning = 'not_requested' | 'mine' | 'waiting_turn' | 'signed_mine' | 'others' | null;

function signingLabel(signing: PortalSigning): { label: string; tone: StatusTone } {
  switch (signing) {
    case 'mine':
      return { label: 'Needs your signature', tone: 'attention' };
    case 'waiting_turn':
      return { label: 'Your turn is coming', tone: 'draft' };
    case 'signed_mine':
      return { label: 'You have signed', tone: 'built' };
    case 'others':
      return { label: 'Waiting for signatures', tone: 'draft' };
    default:
      // Sent, but nobody has been asked to sign it yet.
      return { label: 'Sent to you', tone: 'draft' };
  }
}

/** A document's state in the words a client would use, given what they are being asked to do with it. */
export function portalDocumentStatus(
  status: string,
  asks: 'decision' | 'signature',
  signing: PortalSigning = null,
): { label: string; tone: StatusTone } {
  switch (status) {
    case 'sent':
    case 'viewed':
      return asks === 'decision' ? { label: 'Needs your decision', tone: 'attention' } : signingLabel(signing);
    case 'awaiting_signature':
    case 'partially_signed':
      return signingLabel(signing);
    case 'accepted':
      return { label: 'Accepted', tone: 'built' };
    case 'signed':
      return { label: 'Signed', tone: 'built' };
    case 'declined':
      return { label: 'Declined', tone: 'muted' };
    case 'expired':
      return { label: 'Expired', tone: 'muted' };
    default:
      return { label: 'Sent to you', tone: 'draft' };
  }
}

/** An invoice in the client's words: they care what is left to pay, not the studio's lifecycle. */
export function portalInvoiceStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'paid':
      return { label: 'Paid', tone: 'built' };
    case 'partially_paid':
      return { label: 'Part paid', tone: 'draft' };
    case 'overdue':
      return { label: 'Overdue', tone: 'attention' };
    default:
      return { label: 'To pay', tone: 'attention' };
  }
}

/** A deliverable as the client sees it: whose move it is, rather than the studio's workflow name. */
export function deliverableStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'in_review':
      return { label: 'Needs your review', tone: 'attention' };
    case 'changes_requested':
      return { label: 'Changes asked for', tone: 'draft' };
    case 'approved':
      return { label: 'Approved', tone: 'built' };
    default:
      return { label: 'In progress', tone: 'draft' };
  }
}

/** A change to the work, in the client's words. */
export function changeRequestStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'sent':
      return { label: 'Needs your decision', tone: 'attention' };
    case 'approved':
      return { label: 'Agreed', tone: 'built' };
    case 'declined':
      return { label: 'Declined', tone: 'muted' };
    case 'withdrawn':
      return { label: 'Withdrawn by Unbuilt', tone: 'muted' };
    default:
      return { label: 'With Unbuilt', tone: 'draft' };
  }
}
