import { ConvexError } from 'convex/values';
import { type Doc } from '../_generated/dataModel';

// Change request rules (06-projects.md, Change requests). A change request is a priced change to agreed scope: the
// client approves or declines it, and an approval moves the project's budget and due date and bills the amount once.
// Money is only ever added here, never worked out: the amount is what the studio typed.

export function changeRequestError(code: `changeRequests.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** ₦500,000, until the studio sets its own (18-open-questions.md). */
export const DEFAULT_SIGNATURE_THRESHOLD_MINOR = 500_000_00;

export const OPEN_STATUSES = new Set<Doc<'changeRequests'>['status']>(['draft', 'sent']);

/**
 * Whether the client must sign this change request rather than simply approving it. The client's own setting wins;
 * otherwise it is the studio's threshold, which the amount must reach.
 */
export function needsSignature(
  amountMinor: number,
  client: Pick<Doc<'clients'>, 'changeRequestSignature'>,
  thresholdMinor = DEFAULT_SIGNATURE_THRESHOLD_MINOR,
): boolean {
  if (client.changeRequestSignature === 'always') return true;
  if (client.changeRequestSignature === 'never') return false;
  return amountMinor >= thresholdMinor;
}

/** A change request only reaches a client once, and only while it is still open. */
export function assertSendable(changeRequest: Doc<'changeRequests'>) {
  if (!OPEN_STATUSES.has(changeRequest.status)) {
    throw changeRequestError(
      'changeRequests.decided',
      `This change request has been ${changeRequest.status} and cannot be sent`,
    );
  }
  if (changeRequest.impact.amountMinor === 0 && changeRequest.impact.days === 0) {
    throw changeRequestError('changeRequests.noImpact', 'Say what this changes: an amount, days, or both');
  }
}

/** A decision lands on a change request that is out with the client and has not been decided yet. */
export function assertDecidable(changeRequest: Doc<'changeRequests'>) {
  if (changeRequest.status === 'draft') {
    throw changeRequestError('changeRequests.notSent', 'Send this change request before recording a decision');
  }
  if (changeRequest.status !== 'sent') {
    throw changeRequestError('changeRequests.decided', `This change request has already been ${changeRequest.status}`);
  }
}

/** The project's new due date once a change request buys more days. */
export function pushedDueDate(dueDate: string | undefined, days: number): string | undefined {
  if (!dueDate || days <= 0) return dueDate;
  const pushed = new Date(`${dueDate}T00:00:00Z`);
  pushed.setUTCDate(pushed.getUTCDate() + days);
  return pushed.toISOString().slice(0, 10);
}
