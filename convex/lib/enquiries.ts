import { z } from 'zod';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';

// Enquiries (05-crm.md, Enquiries; 13-cms-and-website.md, Enquiries). The website's enquiry sheet sends option ids;
// the labels below match its current copy and fall back to the id for options added later.

type Ctx = QueryCtx | MutationCtx;

export const SERVICE_LABELS: Record<string, string> = {
  mobile: 'Mobile apps',
  web: 'Web platforms',
  design: 'Product design',
  backend: 'Backends',
  devops: 'DevOps',
  video: 'Video and motion',
  tools: 'Dev tools',
};

export const STAGE_LABELS: Record<string, string> = {
  idea: 'An idea, nothing built yet',
  design: 'Designs, no code',
  live: 'Something live already',
  rescue: 'A build that stalled',
};

export const BUDGET_LABELS: Record<string, string> = {
  small: 'Under ₦4m',
  mid: '₦4m to ₦12m',
  large: '₦12m to ₦35m',
  open: 'Over ₦35m',
  unsure: 'Not sure yet',
};

export const TIMELINE_LABELS: Record<string, string> = {
  asap: 'As soon as possible',
  '1-3': 'In one to three months',
  '3plus': 'Later than three months',
  exploring: 'Just exploring',
};

export const labelFor = (labels: Record<string, string>, id: string | undefined) =>
  id === undefined ? undefined : (labels[id] ?? id);

/** Requests per window for the public endpoint (13-cms-and-website.md). */
export const ENQUIRY_LIMITS = {
  perIp: { max: 5, windowMs: 60 * 60 * 1000 },
  perEmail: { max: 3, windowMs: 24 * 60 * 60 * 1000 },
} as const;

export const MAX_ENQUIRY_BODY_BYTES = 20_000;

const optionId = z
  .string()
  .trim()
  .max(40)
  .regex(/^[a-z0-9-]*$/, 'Unknown option')
  .optional()
  .transform((value) => value || undefined);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

/** The body the website posts. Unknown keys are ignored. */
export const publicEnquirySchema = z.object({
  services: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z0-9-]{1,40}$/),
    )
    .min(1)
    .max(20)
    .transform((values) => [...new Set(values)]),
  stage: optionId,
  budget: optionId,
  timeline: optionId,
  about: optionalText(5000),
  name: z.string().trim().min(1).max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  company: optionalText(120),
  turnstileToken: z.string().min(1).max(2048),
});

export type PublicEnquiry = z.infer<typeof publicEnquirySchema>;

// Rate limits ----------------------------------------------------------------------------------------------------------

/**
 * Counts one request against a fixed window and says whether it is allowed. Mutations run serially, so two requests
 * cannot both take the last slot.
 */
export async function consumeRateLimit(
  db: MutationCtx['db'],
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
  now: number,
): Promise<boolean> {
  const row = await db
    .query('publicRateLimits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
  if (!row) {
    await db.insert('publicRateLimits', { key, windowStart: now, count: 1 });
    return true;
  }
  if (now - row.windowStart >= windowMs) {
    await db.patch('publicRateLimits', row._id, { windowStart: now, count: 1 });
    return true;
  }
  if (row.count >= max) return false;
  await db.patch('publicRateLimits', row._id, { count: row.count + 1 });
  return true;
}

// Origins --------------------------------------------------------------------------------------------------------------

/** Origins allowed to post enquiries: ENQUIRY_ALLOWED_ORIGINS, comma-separated; `*` matches within a host label. */
export function enquiryOrigins(): string[] {
  return (process.env.ENQUIRY_ALLOWED_ORIGINS ?? 'https://unbuilt.studio')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null, allowed: string[] = enquiryOrigins()): boolean {
  if (!origin) return false;
  return allowed.some((pattern) => {
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[a-z0-9-]*')}$`, 'i');
    return regex.test(origin);
  });
}

// Matching an enquiry to a client ---------------------------------------------------------------------------------------

/** Addresses anyone can have, so their domain says nothing about the company. */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'zoho.com',
]);

export const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

function hostnameOf(website: string | undefined): string | undefined {
  if (!website) return undefined;
  try {
    return new URL(website).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

export type ClientMatch = { clientId: Id<'clients'>; clientName: string; reason: 'email' | 'domain' | 'company' };

/**
 * The client an enquiry most likely belongs to: a contact with the same email, then a contact or website on the same
 * company domain (never a free email provider), then a client with the same name as the company.
 */
export async function matchClient(
  ctx: Ctx,
  enquiry: Pick<Doc<'enquiries'>, 'email' | 'company'>,
): Promise<ClientMatch | null> {
  const name = (client: Doc<'clients'>) => client.displayName;

  const sameEmail = await ctx.db
    .query('contacts')
    .withIndex('by_email', (q) => q.eq('email', enquiry.email))
    .collect();
  for (const contact of sameEmail) {
    const client = await ctx.db.get('clients', contact.clientId);
    if (client) return { clientId: client._id, clientName: name(client), reason: 'email' };
  }

  const clients = await ctx.db.query('clients').take(1000);
  const domain = domainOf(enquiry.email);
  if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
    const byWebsite = clients.find((client) => hostnameOf(client.website) === domain);
    if (byWebsite) return { clientId: byWebsite._id, clientName: name(byWebsite), reason: 'domain' };
    for (const client of clients) {
      const contacts = await ctx.db
        .query('contacts')
        .withIndex('by_client', (q) => q.eq('clientId', client._id))
        .collect();
      if (contacts.some((contact) => domainOf(contact.email) === domain)) {
        return { clientId: client._id, clientName: name(client), reason: 'domain' };
      }
    }
  }

  const company = enquiry.company?.trim().toLowerCase();
  if (company) {
    const byName = clients.find(
      (client) => client.displayName.toLowerCase() === company || client.legalName?.toLowerCase() === company,
    );
    if (byName) return { clientId: byName._id, clientName: name(byName), reason: 'company' };
  }
  return null;
}
