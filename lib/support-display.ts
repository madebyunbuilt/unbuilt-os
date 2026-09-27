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

/** A compliance figure as a percentage, or a plain word when nothing was promised at that priority. */
export function compliance(bps: number | undefined): string {
  if (bps === undefined) return 'None raised';
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/** The month a report covers: "October 2026". */
export function monthLabel(periodStart: string): string {
  return new Date(`${periodStart}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** How late something was, in business time: "5 hours late", "2 days late". */
export function lateness(minutes: number): string {
  const said = (amount: number, unit: string) => {
    const shown = amount % 1 === 0 ? String(amount) : amount.toFixed(1);
    return `${shown} ${unit}${shown === '1' ? '' : 's'} late`;
  };
  if (minutes < 60) return said(Math.max(1, Math.round(minutes)), 'minute');
  // A business day is eight hours, so anything longer reads better in days than in a large hour count.
  const hours = minutes / 60;
  return hours < 8 ? said(hours, 'hour') : said(hours / 8, 'business day');
}

export const TARGET_LABEL = { firstResponse: 'First reply', resolution: 'Resolution' } as const;

export type MonitorStatus = 'up' | 'down' | 'paused';

/** Where a monitor stands, in words a person can act on. */
export function monitorStatus(status: MonitorStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'up':
      return { label: 'Answering', tone: 'built' };
    case 'down':
      return { label: 'Down', tone: 'attention' };
    case 'paused':
      return { label: 'Not being checked', tone: 'muted' };
  }
}

/**
 * Uptime as a percentage. Absent when nothing has been checked yet, which is not the same as a perfect record — the
 * same distinction the SLA report makes about a priority nothing came up under.
 */
export function uptime(bps: number | undefined): string {
  if (bps === undefined) return 'Not checked yet';
  const percent = bps / 100;
  // Two decimals near the top, because the difference between 99.9% and 100% is the whole point of measuring.
  return `${percent >= 99 ? percent.toFixed(2) : percent.toFixed(1)}%`;
}

/** How long ago something happened, roughly: "just now", "12 minutes ago", "3 hours ago". */
export function ago(at: number | undefined, now: number): string {
  if (at === undefined) return 'never';
  const ms = now - at;
  if (ms < 90_000) return 'just now';
  return `${gapInWords(ms)} ago`;
}

export type AssetType = 'domain' | 'hosting' | 'ssl' | 'app_store_account' | 'subscription' | 'other';

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  domain: 'Domain',
  hosting: 'Hosting',
  ssl: 'SSL certificate',
  app_store_account: 'App store account',
  subscription: 'Subscription',
  other: 'Other',
};

/**
 * How near a renewal is, in words and in weight. A date that has passed is the loudest thing on the page: a lapsed
 * domain takes a client's site with it, and every day it stays lapsed is worse than the last.
 */
export function renewal(
  daysUntil: number,
  status: 'active' | 'cancelled' | 'transferred',
): {
  label: string;
  tone: StatusTone;
} {
  if (status === 'transferred') return { label: 'Theirs now', tone: 'muted' };
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'muted' };
  if (daysUntil < 0) {
    const late = -daysUntil;
    return { label: `Lapsed ${late} day${late === 1 ? '' : 's'} ago`, tone: 'attention' };
  }
  if (daysUntil === 0) return { label: 'Renews today', tone: 'attention' };
  if (daysUntil === 1) return { label: 'Renews tomorrow', tone: 'attention' };
  return {
    label: `Renews in ${daysUntil} days`,
    // Inside a fortnight it wants somebody's attention; before that it is simply a date.
    tone: daysUntil <= 14 ? 'attention' : daysUntil <= 60 ? 'draft' : 'muted',
  };
}
