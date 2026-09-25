import { type StatusTone } from '@/lib/team-display';

// How a ticket and its SLA read on screen (09-support-and-sla.md). The rule throughout: say what is promised and
// whether it is slipping, in words, rather than showing a timestamp and leaving the person to work it out.

export type TicketStatus = 'new' | 'open' | 'pending_client' | 'resolved' | 'closed';
export type TicketPriority = 'p1' | 'p2' | 'p3' | 'p4';

export function ticketStatus(status: TicketStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'new':
      return { label: 'New', tone: 'attention' };
    case 'open':
      return { label: 'Open', tone: 'draft' };
    case 'pending_client':
      return { label: 'Waiting on the client', tone: 'muted' };
    case 'resolved':
      return { label: 'Resolved', tone: 'built' };
    case 'closed':
      return { label: 'Closed', tone: 'muted' };
  }
}

/** The priority, with the meaning from the policy table, so nobody has to remember what P2 stands for. */
export const PRIORITY_MEANING: Record<TicketPriority, string> = {
  p1: 'Production down or data at risk',
  p2: 'Major feature broken, no workaround',
  p3: 'Minor issue or workaround exists',
  p4: 'Question or small change request',
};

export function priorityLabel(priority: TicketPriority): string {
  return priority.toUpperCase();
}

export function priorityTone(priority: TicketPriority): StatusTone {
  return priority === 'p1' ? 'attention' : priority === 'p2' ? 'draft' : 'muted';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A rough gap in words: "25 minutes", "3 hours", "2 days". Used on both sides of a deadline. */
export function gapInWords(ms: number): string {
  const amount = Math.abs(ms);
  if (amount < HOUR) {
    const minutes = Math.max(1, Math.round(amount / MINUTE));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (amount < DAY) {
    const hours = Math.round(amount / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(amount / DAY);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export type SlaState = { label: string; tone: StatusTone };

/**
 * Where one SLA target stands. `met` is the moment it was met, if it was; a target with no due time was never
 * promised, and says so rather than looking like a target that is comfortably fine.
 *
 * The gap is wall-clock, not business time: it answers "how long have I got", and a person reading it at 16:55 on a
 * Friday knows what their own weekend looks like better than any label could.
 */
export function slaState(what: string, args: { dueAt?: number; met?: number; now: number }, hasSla: boolean): SlaState {
  if (args.met !== undefined) return { label: `${what} sent`, tone: 'built' };
  if (args.dueAt === undefined) {
    return hasSla ? { label: `No ${what.toLowerCase()} promised`, tone: 'muted' } : { label: 'No SLA', tone: 'muted' };
  }
  const left = args.dueAt - args.now;
  if (left < 0) return { label: `${what} ${gapInWords(left)} late`, tone: 'attention' };
  return { label: `${what} due in ${gapInWords(left)}`, tone: left < HOUR ? 'attention' : 'draft' };
}

/** The one line a list row needs: whichever promise is the live one, and how it is doing. */
export function ticketSla(
  ticket: {
    status: TicketStatus;
    hasSla: boolean;
    firstResponseDueAt?: number;
    firstRespondedAt?: number;
    resolutionDueAt?: number;
    resolvedAt?: number;
  },
  now: number,
): SlaState {
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    return { label: ticket.status === 'closed' ? 'Closed' : 'Resolved', tone: 'built' };
  }
  // Waiting on the client stops the resolution clock, so nothing here is counting down.
  if (ticket.status === 'pending_client') return { label: 'Clock paused', tone: 'muted' };
  if (ticket.firstRespondedAt === undefined) {
    return slaState('Reply', { dueAt: ticket.firstResponseDueAt, now }, ticket.hasSla);
  }
  return slaState('Fix', { dueAt: ticket.resolutionDueAt, now }, ticket.hasSla);
}

/** A moment, written out: "12 Oct, 09:55". Ticket timers turn on the hour, so the time is always shown. */
export function formatMoment(at: number): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
