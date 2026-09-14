import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type Currency, isCurrency } from './money';
import { type TeamPermission } from './permissions';
import { authError, type TeamPrincipal } from './principals';
import { isE164, isEmail } from './validation';

// CRM (05-crm.md): clients, contacts, the activity timeline and the rate card.

type Ctx = QueryCtx | MutationCtx;

export function crmError(code: `crm.${string}`, message: string) {
  return new ConvexError({ code, message });
}

export function text(value: string | undefined, label: string, { required = false, max = 200 } = {}) {
  const trimmed = value?.trim();
  if (!trimmed) {
    if (required) throw crmError('crm.invalid', `${label} is required`);
    return undefined;
  }
  if (trimmed.length > max) throw crmError('crm.invalid', `${label} can be at most ${max} characters`);
  return trimmed;
}

export function email(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!isEmail(normalized)) throw crmError('crm.invalid', `"${value}" is not an email address`);
  return normalized;
}

export function phone(value: string | undefined, label: string): string | undefined {
  const cleaned = value?.replace(/[\s()-]/g, '');
  if (!cleaned) return undefined;
  if (!isE164(cleaned)) {
    throw crmError('crm.invalid', `${label} must be an international number, such as +2348012345678`);
  }
  return cleaned;
}

export function website(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.')) throw new Error('no domain');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw crmError('crm.invalid', `"${value}" is not a website address`);
  }
}

export function tags(values: string[]): string[] {
  const cleaned = [...new Set(values.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > 20 || cleaned.some((tag) => tag.length > 40)) {
    throw crmError('crm.invalid', 'Use up to 20 tags of up to 40 characters');
  }
  return cleaned;
}

export function currencyCode(value: string): Currency {
  if (!isCurrency(value)) throw crmError('crm.invalid', `${value} is not a supported currency`);
  return value;
}

export async function getClient(ctx: Ctx, clientId: Id<'clients'>): Promise<Doc<'clients'>> {
  const client = await ctx.db.get('clients', clientId);
  if (!client) throw crmError('crm.notFound', 'Client not found');
  return client;
}

export async function getContact(ctx: Ctx, contactId: Id<'contacts'>): Promise<Doc<'contacts'>> {
  const contact = await ctx.db.get('contacts', contactId);
  if (!contact) throw crmError('crm.notFound', 'Contact not found');
  return contact;
}

export async function assertActiveMember(ctx: Ctx, memberId: Id<'teamMembers'> | undefined) {
  if (!memberId) return;
  const member = await ctx.db.get('teamMembers', memberId);
  if (!member || member.status !== 'active') throw crmError('crm.invalid', 'The owner must be an active team member');
}

export function requirePermission(principal: TeamPrincipal, permission: TeamPermission) {
  if (!principal.permissions.has(permission)) throw authError('auth.forbidden', 'You do not have access to this');
}

// Activity timeline --------------------------------------------------------------------------------------------------

export type ActivitySubject = Doc<'activities'>['subject'];

/** Writes a timeline entry. System events use this; manual notes go through activities.add. */
export async function recordActivity(
  ctx: { db: MutationCtx['db'] },
  entry: {
    subject: ActivitySubject;
    clientId?: Id<'clients'>;
    type: Doc<'activities'>['type'];
    title: string;
    body?: string;
    actor: { kind: 'team' | 'client' | 'system'; id?: string };
    occurredAt?: number;
    meta?: Doc<'activities'>['meta'];
  },
): Promise<Id<'activities'>> {
  const occurredAt = entry.occurredAt ?? Date.now();
  if (entry.subject.table === 'deals') await touchDeal(ctx, entry.subject.id, occurredAt);
  return await ctx.db.insert('activities', {
    subject: entry.subject,
    clientId: entry.clientId,
    type: entry.type,
    title: entry.title,
    body: entry.body,
    actorKind: entry.actor.kind,
    actorId: entry.actor.id,
    occurredAt,
    meta: entry.meta,
  });
}

/**
 * A timeline entry on a deal is activity for its follow-up reminders. Entries logged for a past date count from that
 * date, and never move the deal's last activity backwards or into the future.
 */
export async function touchDeal(ctx: { db: MutationCtx['db'] }, dealId: string, occurredAt: number) {
  const id = ctx.db.normalizeId('deals', dealId);
  const deal = id ? await ctx.db.get('deals', id) : null;
  const at = Math.min(occurredAt, Date.now());
  if (deal && at > deal.lastActivityAt) await ctx.db.patch('deals', deal._id, { lastActivityAt: at });
}

/**
 * Mentions are written in note bodies as `@[Dayo Ade](member:ID)`, as the mention picker inserts them. Returns the
 * distinct member ids in order of appearance.
 */
export function mentionedMemberIds(body: string): string[] {
  const ids = [...body.matchAll(/@\[[^\]\n]{1,120}\]\(member:([a-z0-9]+)\)/gi)].map((match) => match[1]);
  return [...new Set(ids)];
}

/** The body with mention markup replaced by "@Name", for notifications and plain text. */
export function plainMentions(body: string): string {
  return body.replace(/@\[([^\]\n]{1,120})\]\(member:[a-z0-9]+\)/gi, '@$1');
}

// Rate card -----------------------------------------------------------------------------------------------------------

/**
 * The item's price in a document's currency, or null when it has none. Never converted: the person adding the item
 * must enter a price for that document (05-crm.md, Rate card).
 */
export function unitPriceFor(item: Pick<Doc<'rateCardItems'>, 'prices'>, currency: Currency): number | null {
  return item.prices.find((price) => price.currency === currency)?.unitPriceMinor ?? null;
}

/** The unit price to put on a document line: the rate card price, or the manual price when there is none. */
export function lineUnitPrice(
  item: Pick<Doc<'rateCardItems'>, 'prices' | 'active' | 'name'>,
  currency: Currency,
  manualPriceMinor?: number,
): number {
  if (!item.active) throw crmError('crm.inactiveItem', `${item.name} is no longer offered`);
  if (manualPriceMinor !== undefined) {
    if (!Number.isSafeInteger(manualPriceMinor) || manualPriceMinor < 0) {
      throw crmError('crm.invalid', 'The price must be a whole, non-negative amount in minor units');
    }
    return manualPriceMinor;
  }
  const price = unitPriceFor(item, currency);
  if (price === null) {
    throw crmError('crm.priceRequired', `${item.name} has no ${currency} price. Enter one for this document.`);
  }
  return price;
}

// WhatsApp --------------------------------------------------------------------------------------------------------------

/**
 * Whether a WhatsApp message may be sent to this contact: active, with a number and recorded opt-in. Every WhatsApp
 * send checks this first (14-platform.md, WhatsApp).
 */
export function canMessageOnWhatsapp(contact: Pick<Doc<'contacts'>, 'status' | 'whatsapp' | 'whatsappOptIn'>): boolean {
  return contact.status === 'active' && !!contact.whatsapp && isE164(contact.whatsapp) && !!contact.whatsappOptIn;
}
