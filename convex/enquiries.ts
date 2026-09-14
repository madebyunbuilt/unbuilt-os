import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type QueryCtx } from './_generated/server';
import { createDeal } from './deals';
import { auditedDatabase } from './lib/audit';
import { crmError, email as cleanEmail, getClient, recordActivity, requirePermission, text } from './lib/crm';
import { orderedStages } from './lib/deals';
import {
  BUDGET_LABELS,
  consumeRateLimit,
  ENQUIRY_LIMITS,
  isAllowedOrigin,
  labelFor,
  matchClient,
  MAX_ENQUIRY_BODY_BYTES,
  publicEnquirySchema,
  SERVICE_LABELS,
  STAGE_LABELS,
  TIMELINE_LABELS,
} from './lib/enquiries';
import { internalMutation, publicHttp, teamMutation, teamQuery } from './lib/functions';
import { getOrgSettings } from './lib/settings';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';

// Enquiries (05-crm.md, Enquiries; 13-cms-and-website.md). The website posts to POST /public/enquiries; the team works
// the inbox. The sender's IP address and browser are shown only with audit.view (decided by the studio on 2026-09-14).

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RATE_LIMIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

type EnquiryStatus = Doc<'enquiries'>['status'];

// Public endpoint ------------------------------------------------------------------------------------------------------

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: object, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** The caller's address as the edge saw it. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('cf-connecting-ip') ?? forwarded ?? request.headers.get('x-real-ip') ?? 'unknown';
}

export async function verifyTurnstile(token: string, ip: string): Promise<boolean | 'unconfigured'> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return 'unconfigured';
  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, ...(ip !== 'unknown' ? { remoteip: ip } : {}) }),
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

export const preflight = publicHttp(async (_ctx, request) => {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin!) });
});

/**
 * POST /public/enquiries. Checks the origin, the body, Turnstile and the rate limits, in that order, and stores the
 * enquiry only when all pass. Responds `{ ok: true }` without internal ids.
 */
export const submit = publicHttp(async (ctx, request) => {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) return json({ ok: false, error: 'origin' }, 403);
  const cors = corsHeaders(origin!);

  const raw = await request.text();
  if (raw.length > MAX_ENQUIRY_BODY_BYTES) return json({ ok: false, error: 'invalid' }, 413, cors);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'invalid' }, 400, cors);
  }
  const parsed = publicEnquirySchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: 'invalid' }, 400, cors);

  const ip = clientIp(request);
  const verified = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (verified === 'unconfigured') {
    console.error('Enquiry refused: TURNSTILE_SECRET_KEY is not set on this deployment');
    return json({ ok: false, error: 'unavailable' }, 503, cors);
  }
  if (!verified) return json({ ok: false, error: 'turnstile' }, 403, cors);

  const { turnstileToken: _token, ...fields } = parsed.data;
  const result = await ctx.runMutation(internal.enquiries.receive, {
    ...fields,
    ip,
    userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? undefined,
  });
  if (!result.ok) return json({ ok: false, error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '3600' });
  return json({ ok: true }, 200, cors);
});

/** Stores a website enquiry that passed Turnstile, unless the sender or their address is over the limit. */
export const receive = internalMutation({
  args: {
    services: v.array(v.string()),
    stage: v.optional(v.string()),
    budget: v.optional(v.string()),
    timeline: v.optional(v.string()),
    about: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    company: v.optional(v.string()),
    ip: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { ip, userAgent, ...fields }) => {
    const now = Date.now();
    // The IP is counted first: a request refused for its email address still used one of the IP's slots.
    const ipAllowed = await consumeRateLimit(ctx.db, `enquiry:ip:${ip}`, ENQUIRY_LIMITS.perIp, now);
    if (!ipAllowed) return { ok: false as const };
    const emailAllowed = await consumeRateLimit(ctx.db, `enquiry:email:${fields.email}`, ENQUIRY_LIMITS.perEmail, now);
    if (!emailAllowed) return { ok: false as const };

    const db = auditedDatabase(ctx.db, { actorKind: 'system', permission: 'public.enquiry', ip, userAgent });
    const enquiryId = await db.insert('enquiries', {
      source: 'website',
      ...fields,
      status: 'new',
      ip,
      userAgent,
      turnstilePassed: true,
      receivedAt: now,
    });
    await notifyNewEnquiry({ db }, ctx, enquiryId, fields);
    return { ok: true as const };
  },
});

async function notifyNewEnquiry(
  writer: { db: Parameters<typeof notifyTeamMembers>[0]['db'] },
  ctx: QueryCtx,
  enquiryId: Id<'enquiries'>,
  enquiry: { name: string; company?: string; services: string[] },
  exceptMemberId?: Id<'teamMembers'>,
) {
  const recipients = (await activeMembersWith(ctx, 'enquiries.manage')).filter((id) => id !== exceptMemberId);
  const services = enquiry.services.map((slug) => labelFor(SERVICE_LABELS, slug)).join(', ');
  await notifyTeamMembers(writer, recipients, {
    event: 'enquiry.received',
    title: `New enquiry from ${enquiry.name}${enquiry.company ? ` at ${enquiry.company}` : ''}`,
    body: services || 'No services chosen',
    link: `/crm/enquiries/${enquiryId}`,
  });
}

/** Daily: forgets rate-limit windows that ended long ago. */
export const cleanupRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query('publicRateLimits')
      .withIndex('by_windowStart', (q) => q.lt('windowStart', Date.now() - RATE_LIMIT_RETENTION_MS))
      .take(500);
    for (const row of stale) await ctx.db.delete('publicRateLimits', row._id);
    if (stale.length === 500) await ctx.scheduler.runAfter(0, internal.enquiries.cleanupRateLimits, {});
    return { deleted: stale.length };
  },
});

// Inbox ----------------------------------------------------------------------------------------------------------------

function summary(enquiry: Doc<'enquiries'>) {
  return {
    id: enquiry._id,
    source: enquiry.source,
    name: enquiry.name,
    email: enquiry.email,
    company: enquiry.company,
    services: enquiry.services.map((slug) => ({ slug, label: labelFor(SERVICE_LABELS, slug)! })),
    budget: labelFor(BUDGET_LABELS, enquiry.budget),
    status: enquiry.status,
    receivedAt: enquiry.receivedAt,
    clientId: enquiry.clientId,
    dealId: enquiry.dealId,
  };
}

async function getEnquiry(ctx: QueryCtx, enquiryId: Id<'enquiries'>) {
  const enquiry = await ctx.db.get('enquiries', enquiryId);
  if (!enquiry) throw crmError('crm.notFound', 'Enquiry not found');
  return enquiry;
}

/** Open enquiries (new first, then reviewed, newest first), or one of the closed groups. */
export const list = teamQuery('enquiries.view')({
  args: {
    view: v.optional(v.union(v.literal('open'), v.literal('converted'), v.literal('spam'), v.literal('closed'))),
  },
  handler: async (ctx, { view = 'open' }) => {
    const statuses: EnquiryStatus[] = view === 'open' ? ['new', 'reviewed'] : [view];
    const rows: Doc<'enquiries'>[] = [];
    for (const status of statuses) {
      rows.push(
        ...(await ctx.db
          .query('enquiries')
          .withIndex('by_status_received', (q) => q.eq('status', status))
          .order('desc')
          .take(200)),
      );
    }
    return await Promise.all(
      rows.map(async (enquiry) => {
        const existing = await ctx.db
          .query('contacts')
          .withIndex('by_email', (q) => q.eq('email', enquiry.email))
          .first();
        const client = existing ? await ctx.db.get('clients', existing.clientId) : null;
        return { ...summary(enquiry), existingClient: client ? { id: client._id, name: client.displayName } : null };
      }),
    );
  },
});

/**
 * One enquiry with everything needed to act on it: the full answers, any contacts who already use this email (with
 * their clients' open deals), and the likely client for converting it.
 */
export const get = teamQuery('enquiries.view')({
  args: { enquiryId: v.id('enquiries') },
  handler: async (ctx, { enquiryId }) => {
    const enquiry = await getEnquiry(ctx, enquiryId);
    const openStageIds = new Set(
      (await orderedStages(ctx)).filter((stage) => stage.kind === 'open').map((stage) => stage._id),
    );
    const contacts = await ctx.db
      .query('contacts')
      .withIndex('by_email', (q) => q.eq('email', enquiry.email))
      .collect();
    const existing = await Promise.all(
      contacts.map(async (contact) => {
        const client = await ctx.db.get('clients', contact.clientId);
        const deals = ctx.can('deals.view')
          ? (
              await ctx.db
                .query('deals')
                .withIndex('by_client', (q) => q.eq('clientId', contact.clientId))
                .collect()
            ).filter((deal) => openStageIds.has(deal.stageId))
          : [];
        return {
          contactId: contact._id,
          contactName: contact.name,
          contactStatus: contact.status,
          clientId: contact.clientId,
          clientName: client?.displayName ?? 'Unknown client',
          openDeals: deals.map((deal) => ({
            id: deal._id,
            title: deal.title,
            valueMinor: deal.valueMinor,
            currency: deal.currency,
          })),
        };
      }),
    );
    const decidedBy = enquiry.decidedBy ? await ctx.db.get('teamMembers', enquiry.decidedBy) : null;
    return {
      ...summary(enquiry),
      stage: labelFor(STAGE_LABELS, enquiry.stage),
      timeline: labelFor(TIMELINE_LABELS, enquiry.timeline),
      about: enquiry.about,
      decidedByName: decidedBy?.name,
      decidedAt: enquiry.decidedAt,
      existing,
      suggestedClient: await matchClient(ctx, enquiry),
      ...(ctx.can('audit.view') ? { ip: enquiry.ip, userAgent: enquiry.userAgent } : {}),
    };
  },
});

const TRANSITIONS: Record<'reviewed' | 'spam' | 'closed' | 'reopen', EnquiryStatus[]> = {
  reviewed: ['new'],
  spam: ['new', 'reviewed', 'closed'],
  closed: ['new', 'reviewed', 'spam'],
  reopen: ['spam', 'closed'],
};

function setStatus(action: keyof typeof TRANSITIONS) {
  return teamMutation('enquiries.manage')({
    args: { enquiryId: v.id('enquiries') },
    handler: async (ctx, { enquiryId }) => {
      const enquiry = await getEnquiry(ctx, enquiryId);
      if (!TRANSITIONS[action].includes(enquiry.status)) {
        if (action === 'reviewed') return;
        throw crmError('crm.invalid', `This enquiry is ${enquiry.status}`);
      }
      const status: EnquiryStatus = action === 'reopen' ? 'reviewed' : action;
      await ctx.db.patch('enquiries', enquiryId, {
        status,
        decidedBy: ctx.principal.member._id,
        decidedAt: Date.now(),
      });
    },
  });
}

/** Opening an enquiry marks it reviewed. */
export const markReviewed = setStatus('reviewed');
export const markSpam = setStatus('spam');
export const close = setStatus('closed');
export const reopen = setStatus('reopen');

/** An enquiry that arrived another way: by email, by referral, or in person. */
export const createManual = teamMutation('enquiries.manage')({
  args: {
    source: v.union(v.literal('manual'), v.literal('email'), v.literal('referral')),
    name: v.string(),
    email: v.string(),
    company: v.optional(v.string()),
    services: v.array(v.string()),
    about: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fields = {
      name: text(args.name, 'Name', { required: true, max: 120 })!,
      email: cleanEmail(args.email),
      company: text(args.company, 'Company', { max: 120 }),
      services: [...new Set(args.services.map((slug) => slug.trim()).filter(Boolean))].slice(0, 20),
      about: text(args.about, 'About', { max: 5000 }),
    };
    const enquiryId = await ctx.db.insert('enquiries', {
      source: args.source,
      ...fields,
      status: 'reviewed',
      turnstilePassed: false,
      receivedAt: Date.now(),
      createdBy: ctx.principal.member._id,
    });
    await notifyNewEnquiry(ctx, ctx, enquiryId, fields, ctx.principal.member._id);
    return enquiryId;
  },
});

/**
 * Converts an enquiry into a deal in the first open stage, for an existing client or a new one. The contact is the
 * client's active contact with the enquiry's email, or a new one. Needs the permissions for each record it creates.
 */
export const convert = teamMutation('enquiries.manage')({
  args: {
    enquiryId: v.id('enquiries'),
    client: v.union(
      v.object({ kind: v.literal('existing'), clientId: v.id('clients') }),
      v.object({
        kind: v.literal('new'),
        displayName: v.string(),
        clientKind: v.union(v.literal('company'), v.literal('individual')),
      }),
    ),
    deal: v.object({
      title: v.string(),
      valueMinor: v.number(),
      currency: v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR')),
      expectedCloseDate: v.optional(v.string()),
      ownerMemberId: v.optional(v.id('teamMembers')),
    }),
  },
  handler: async (ctx, args) => {
    const enquiry = await getEnquiry(ctx, args.enquiryId);
    if (enquiry.status === 'converted') throw crmError('crm.alreadyConverted', 'This enquiry is already converted');
    requirePermission(ctx.principal, 'deals.manage');
    const me = ctx.principal.member._id;

    let clientId: Id<'clients'>;
    if (args.client.kind === 'existing') {
      clientId = (await getClient(ctx, args.client.clientId))._id;
    } else {
      requirePermission(ctx.principal, 'clients.create');
      const displayName = text(args.client.displayName, 'Client name', { required: true, max: 120 })!;
      const clash = (await ctx.db.query('clients').take(1000)).find(
        (client) => client.displayName.toLowerCase() === displayName.toLowerCase(),
      );
      if (clash) throw crmError('crm.duplicate', `${clash.displayName} is already a client. Choose it instead.`);
      const settings = await getOrgSettings(ctx);
      clientId = await ctx.db.insert('clients', {
        displayName,
        kind: args.client.clientKind,
        status: 'lead',
        ownerMemberId: args.deal.ownerMemberId ?? me,
        source: enquiry.source,
        country: settings.country,
        timezone: settings.timezone,
        defaultCurrency: settings.defaultCurrency,
        tags: [],
        portalEnabled: false,
      });
      await recordActivity(ctx, {
        subject: { table: 'clients', id: clientId },
        clientId,
        type: 'system',
        title: 'Client created from an enquiry',
        actor: { kind: 'team', id: me },
      });
    }

    const contacts = await ctx.db
      .query('contacts')
      .withIndex('by_client', (q) => q.eq('clientId', clientId))
      .collect();
    let contact = contacts.find((c) => c.email === enquiry.email && c.status === 'active');
    if (!contact) {
      requirePermission(ctx.principal, 'contacts.manage');
      const contactId = await ctx.db.insert('contacts', {
        clientId,
        name: enquiry.name,
        email: enquiry.email,
        isPrimary: !contacts.some((c) => c.isPrimary && c.status === 'active'),
        isBilling: false,
        portalAccess: false,
        status: 'active',
      });
      await recordActivity(ctx, {
        subject: { table: 'contacts', id: contactId },
        clientId,
        type: 'system',
        title: `${enquiry.name} added as a contact from an enquiry`,
        actor: { kind: 'team', id: me },
      });
      contact = (await ctx.db.get('contacts', contactId))!;
    }

    const dealId = await createDeal(ctx, {
      clientId,
      enquiryId: enquiry._id,
      title: args.deal.title,
      primaryContactId: contact._id,
      valueMinor: args.deal.valueMinor,
      currency: args.deal.currency,
      expectedCloseDate: args.deal.expectedCloseDate,
      ownerMemberId: args.deal.ownerMemberId,
      services: enquiry.services,
      source: enquiry.source,
    });
    await ctx.db.patch('enquiries', enquiry._id, {
      status: 'converted',
      clientId,
      dealId,
      decidedBy: me,
      decidedAt: Date.now(),
    });
    return { clientId, contactId: contact._id, dealId };
  },
});
