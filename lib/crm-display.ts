import { formatDateRange } from '@/convex/lib/timeOffFormat';
import { type StatusTone } from '@/lib/team-display';

// How CRM records are shown: labels in the brand's state colours, and @mentions in notes.

export type ClientStatus = 'lead' | 'active' | 'past' | 'archived';

export function clientStatus(status: ClientStatus): { label: string; tone: StatusTone } {
  switch (status) {
    // A lead is not built yet.
    case 'lead':
      return { label: 'Lead', tone: 'draft' };
    case 'active':
      return { label: 'Active', tone: 'built' };
    case 'past':
      return { label: 'Past', tone: 'muted' };
    case 'archived':
      return { label: 'Archived', tone: 'muted' };
  }
}

export const CLIENT_STATUSES: ClientStatus[] = ['lead', 'active', 'past', 'archived'];

export const VAT_TREATMENT_LABELS = {
  standard: 'Standard rate',
  zero_rated: 'Zero-rated',
  exempt: 'Exempt',
} as const;

export const RATE_UNIT_LABELS = {
  fixed: 'Fixed price',
  hour: 'Per hour',
  day: 'Per day',
  week: 'Per week',
  month: 'Per month',
} as const;

export const OPT_IN_METHOD_LABELS = {
  portal_checkbox: 'Portal checkbox',
  written_consent: 'Written consent',
  form: 'Form',
} as const;

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  note: 'Note',
  call: 'Call',
  meeting: 'Meeting',
  email_sent: 'Email sent',
  email_received: 'Email received',
  whatsapp_sent: 'WhatsApp sent',
  status_change: 'Status change',
  document_event: 'Document',
  payment_event: 'Payment',
  system: 'Update',
};

/** Tags typed as "retainer, saas" to a list. */
export function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export type EnquiryStatus = 'new' | 'reviewed' | 'converted' | 'spam' | 'closed';

export function enquiryStatus(status: EnquiryStatus): { label: string; tone: StatusTone } {
  switch (status) {
    // A new enquiry needs someone to look at it.
    case 'new':
      return { label: 'New', tone: 'attention' };
    case 'reviewed':
      return { label: 'Reviewed', tone: 'draft' };
    case 'converted':
      return { label: 'Converted', tone: 'built' };
    case 'spam':
      return { label: 'Spam', tone: 'muted' };
    case 'closed':
      return { label: 'Closed', tone: 'muted' };
  }
}

export const ENQUIRY_SOURCE_LABELS = {
  website: 'Website',
  manual: 'In person',
  email: 'Email',
  referral: 'Referral',
} as const;

export function stageTone(kind: 'open' | 'won' | 'lost'): StatusTone {
  // An open deal is not built yet; won is final; lost is done.
  return kind === 'open' ? 'draft' : kind === 'won' ? 'built' : 'muted';
}

/** A date (YYYY-MM-DD) for display: "25 Sep 2026". */
export function formatDay(date: string): string {
  return formatDateRange(date, date);
}

/** Minor units as a plain amount for an input: 150000 → "1500". */
export function toAmountInput(minor: number | undefined): string {
  return minor === undefined ? '' : (minor / 100).toFixed(2).replace(/\.00$/, '');
}

// Mentions --------------------------------------------------------------------------------------------------------------
// Stored as `@[Dayo Ade](member:ID)`, which the server reads to notify people. People type and see "@Dayo Ade".

export type Mention = { id: string; name: string };

const MARKUP = /@\[([^\]\n]{1,120})\]\(member:([a-z0-9]+)\)/gi;

/** The stored body as people see it, with the members it mentions. */
export function fromMentionMarkup(body: string): { text: string; mentions: Mention[] } {
  const mentions = new Map<string, Mention>();
  const text = body.replace(MARKUP, (_match, name: string, id: string) => {
    mentions.set(id, { id, name });
    return `@${name}`;
  });
  return { text, mentions: [...mentions.values()] };
}

/** The typed text with each chosen member's "@Name" turned into mention markup. Mentions deleted from the text drop out. */
export function toMentionMarkup(text: string, mentions: Mention[]): string {
  // Longest names first, so "@Dayo Ade" is not caught by a mention of "@Dayo".
  const ordered = [...mentions].sort((a, b) => b.name.length - a.name.length);
  let result = text;
  for (const mention of ordered) {
    const escaped = mention.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`@${escaped}(?![\\w-])`, 'g'), `@[${mention.name}](member:${mention.id})`);
  }
  return result;
}

/** A stored body split into plain text and mentions, for rendering. */
export function mentionSegments(body: string): ({ kind: 'text'; text: string } | { kind: 'mention'; name: string })[] {
  const segments: ({ kind: 'text'; text: string } | { kind: 'mention'; name: string })[] = [];
  let last = 0;
  for (const match of body.matchAll(MARKUP)) {
    if (match.index > last) segments.push({ kind: 'text', text: body.slice(last, match.index) });
    segments.push({ kind: 'mention', name: match[1] });
    last = match.index + match[0].length;
  }
  if (last < body.length) segments.push({ kind: 'text', text: body.slice(last) });
  return segments;
}
