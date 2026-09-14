import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import {
  assertActiveMember,
  crmError,
  currencyCode,
  getClient,
  recordActivity,
  tags as cleanTags,
  text,
  website,
} from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { getOrgSettings } from './lib/settings';
import { revokeAllSessions } from './lib/principals';
import { isTimeZone } from './lib/validation';

// Clients (05-crm.md, Clients). Billing details (legal name, address, TIN, VAT treatment, WHT, currency, payment terms)
// are edited with invoices.update, so Finance sets tax details and project managers see them read-only (decided by the
// studio on 2026-09-14). Deleting is only for clients nothing depends on; everything else is archived.

type Ctx = QueryCtx | MutationCtx;

const LIST_LIMIT = 500;
const STATUS_LABELS: Record<Doc<'clients'>['status'], string> = {
  lead: 'Lead',
  active: 'Active',
  past: 'Past',
  archived: 'Archived',
};

const status = v.union(v.literal('lead'), v.literal('active'), v.literal('past'), v.literal('archived'));
const vatTreatment = v.union(v.literal('standard'), v.literal('zero_rated'), v.literal('exempt'));

function clientView(client: Doc<'clients'>, ownerName: string | undefined) {
  return {
    id: client._id,
    displayName: client.displayName,
    legalName: client.legalName,
    kind: client.kind,
    status: client.status,
    industry: client.industry,
    website: client.website,
    country: client.country,
    addressLines: client.addressLines ?? [],
    tin: client.tin,
    vatTreatment: client.vatTreatment ?? 'standard',
    whtApplies: client.whtApplies ?? false,
    whtBps: client.whtBps,
    defaultCurrency: client.defaultCurrency,
    paymentTermsDays: client.paymentTermsDays,
    timezone: client.timezone,
    ownerMemberId: client.ownerMemberId,
    ownerName,
    source: client.source,
    tags: client.tags ?? [],
    notes: client.notes,
    slaPolicyId: client.slaPolicyId,
    portalEnabled: client.portalEnabled,
    createdAt: client._creationTime,
  };
}

async function ownerName(ctx: Ctx, client: Doc<'clients'>) {
  return client.ownerMemberId ? (await ctx.db.get('teamMembers', client.ownerMemberId))?.name : undefined;
}

async function assertUniqueName(ctx: Ctx, displayName: string, exceptId?: Id<'clients'>) {
  const matches = await ctx.db
    .query('clients')
    .withSearchIndex('search_displayName', (q) => q.search('displayName', displayName))
    .take(20);
  const clash = matches.find(
    (client) => client._id !== exceptId && client.displayName.toLowerCase() === displayName.toLowerCase(),
  );
  if (clash) throw crmError('crm.duplicate', `${clash.displayName} is already a client`);
}

function country(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  if (!code) return undefined;
  if (!/^[A-Z]{2}$/.test(code)) throw crmError('crm.invalid', 'Country must be a two-letter code, such as NG');
  return code;
}

function timezone(value: string): string {
  if (!isTimeZone(value)) throw crmError('crm.invalid', `"${value}" is not a timezone`);
  return value;
}

export const list = teamQuery('clients.view')({
  args: {
    status: v.optional(status),
    ownerMemberId: v.optional(v.id('teamMembers')),
    tag: v.optional(v.string()),
    industry: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // A studio has hundreds of clients at most, so a substring match on both names is simple and forgiving.
    const term = args.search?.trim().toLowerCase();
    const wanted = args.status;
    const clients: Doc<'clients'>[] = wanted
      ? await ctx.db
          .query('clients')
          .withIndex('by_status', (q) => q.eq('status', wanted))
          .take(LIST_LIMIT)
      : await ctx.db.query('clients').take(LIST_LIMIT);

    const tag = args.tag?.trim().toLowerCase();
    const industry = args.industry?.trim().toLowerCase();
    const filtered = clients.filter(
      (client) =>
        // Archived clients appear only when asked for.
        (args.status ? client.status === args.status : client.status !== 'archived') &&
        (!args.ownerMemberId || client.ownerMemberId === args.ownerMemberId) &&
        (!tag || (client.tags ?? []).includes(tag)) &&
        (!industry || client.industry?.toLowerCase() === industry) &&
        (!term || [client.displayName, client.legalName].some((name) => name?.toLowerCase().includes(term))),
    );

    const views = await Promise.all(
      filtered.map(async (client) => {
        const contacts = await ctx.db
          .query('contacts')
          .withIndex('by_client', (q) => q.eq('clientId', client._id))
          .collect();
        const primary = contacts.find((contact) => contact.isPrimary && contact.status === 'active');
        return {
          ...clientView(client, await ownerName(ctx, client)),
          primaryContact: primary ? { id: primary._id, name: primary.name, email: primary.email } : null,
          contactCount: contacts.filter((contact) => contact.status === 'active').length,
        };
      }),
    );
    return views.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const get = teamQuery('clients.view')({
  args: { clientId: v.id('clients') },
  handler: async (ctx, { clientId }) => {
    const client = await getClient(ctx, clientId);
    const sla = client.slaPolicyId ? await ctx.db.get('slaPolicies', client.slaPolicyId) : null;
    return { ...clientView(client, await ownerName(ctx, client)), slaPolicyName: sla?.name };
  },
});

/** Tags and industries in use, for filters and suggestions. */
export const facets = teamQuery('clients.view')({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db.query('clients').take(LIST_LIMIT);
    const count = (values: string[]) => [...new Set(values)].sort();
    return {
      tags: count(clients.flatMap((client) => client.tags ?? [])),
      industries: count(clients.map((client) => client.industry).filter((value): value is string => !!value)),
    };
  },
});

const profileArgs = {
  displayName: v.string(),
  kind: v.union(v.literal('company'), v.literal('individual')),
  industry: v.optional(v.string()),
  website: v.optional(v.string()),
  country: v.optional(v.string()),
  timezone: v.optional(v.string()),
  ownerMemberId: v.optional(v.id('teamMembers')),
  source: v.optional(v.string()),
  tags: v.array(v.string()),
  notes: v.optional(v.string()),
};

type ProfileInput = {
  displayName: string;
  kind: Doc<'clients'>['kind'];
  industry?: string;
  website?: string;
  country?: string;
  ownerMemberId?: Id<'teamMembers'>;
  source?: string;
  tags: string[];
  notes?: string;
};

async function checkedProfile(ctx: Ctx, args: ProfileInput) {
  await assertActiveMember(ctx, args.ownerMemberId);
  return {
    displayName: text(args.displayName, 'Name', { required: true, max: 120 })!,
    kind: args.kind,
    industry: text(args.industry, 'Industry', { max: 60 }),
    website: website(args.website),
    country: country(args.country),
    ownerMemberId: args.ownerMemberId,
    source: text(args.source, 'Source', { max: 60 }),
    tags: cleanTags(args.tags),
    notes: text(args.notes, 'Notes', { max: 2000 }),
  };
}

export const create = teamMutation('clients.create')({
  args: profileArgs,
  handler: async (ctx, args) => {
    const profile = await checkedProfile(ctx, args);
    await assertUniqueName(ctx, profile.displayName);
    const settings = await getOrgSettings(ctx);
    const clientId = await ctx.db.insert('clients', {
      ...profile,
      ownerMemberId: profile.ownerMemberId ?? ctx.principal.member._id,
      country: profile.country ?? settings.country,
      timezone: args.timezone ? timezone(args.timezone) : settings.timezone,
      defaultCurrency: settings.defaultCurrency,
      status: 'lead',
      portalEnabled: false,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: clientId },
      clientId,
      type: 'system',
      title: 'Client created',
      actor: { kind: 'team', id: ctx.principal.member._id },
    });
    return clientId;
  },
});

export const update = teamMutation('clients.update')({
  args: { clientId: v.id('clients'), ...profileArgs },
  handler: async (ctx, { clientId, ...args }) => {
    const client = await getClient(ctx, clientId);
    const profile = await checkedProfile(ctx, args);
    if (profile.displayName.toLowerCase() !== client.displayName.toLowerCase()) {
      await assertUniqueName(ctx, profile.displayName, clientId);
    }
    await ctx.db.patch('clients', clientId, {
      ...profile,
      timezone: args.timezone ? timezone(args.timezone) : client.timezone,
    });
  },
});

/** Billing details used by invoices. invoices.update: Owner, Admins and Finance. */
export const updateBilling = teamMutation('invoices.update')({
  args: {
    clientId: v.id('clients'),
    legalName: v.optional(v.string()),
    addressLines: v.array(v.string()),
    tin: v.optional(v.string()),
    vatTreatment,
    whtApplies: v.boolean(),
    whtBps: v.optional(v.number()),
    defaultCurrency: v.string(),
    paymentTermsDays: v.optional(v.number()),
  },
  handler: async (ctx, { clientId, ...args }) => {
    await getClient(ctx, clientId);
    const addressLines = args.addressLines
      .map((line) => text(line, 'Address line', { max: 120 }))
      .filter((line): line is string => line !== undefined);
    if (addressLines.length > 6) throw crmError('crm.invalid', 'Use at most 6 address lines');
    if (args.whtApplies) {
      if (args.whtBps === undefined || !Number.isInteger(args.whtBps) || args.whtBps <= 0 || args.whtBps > 10_000) {
        throw crmError('crm.invalid', 'Enter the WHT rate the client deducts, such as 5%');
      }
    }
    const terms = args.paymentTermsDays;
    if (terms !== undefined && (!Number.isInteger(terms) || terms < 0 || terms > 365)) {
      throw crmError('crm.invalid', 'Payment terms must be a whole number of days, 0 to 365');
    }
    await ctx.db.patch('clients', clientId, {
      legalName: text(args.legalName, 'Legal name', { max: 200 }),
      addressLines,
      tin: text(args.tin, 'TIN', { max: 40 }),
      vatTreatment: args.vatTreatment,
      whtApplies: args.whtApplies,
      whtBps: args.whtApplies ? args.whtBps : undefined,
      defaultCurrency: currencyCode(args.defaultCurrency),
      paymentTermsDays: terms,
    });
  },
});

/**
 * Sets the status by hand. Lead → active and active → past also happen automatically once projects exist; a manual
 * change is recorded on the timeline with the reason.
 */
export const setStatus = teamMutation('clients.update')({
  args: { clientId: v.id('clients'), status, reason: v.optional(v.string()) },
  handler: async (ctx, { clientId, status: next, reason }) => {
    const client = await getClient(ctx, clientId);
    if (client.status === next) return;
    await ctx.db.patch('clients', clientId, { status: next });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: clientId },
      clientId,
      type: 'status_change',
      title: `Status changed from ${STATUS_LABELS[client.status]} to ${STATUS_LABELS[next]}`,
      body: text(reason, 'Reason', { max: 500 }),
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { from: client.status, to: next, manual: true },
    });
  },
});

export const setSlaPolicy = teamMutation('clients.update')({
  args: { clientId: v.id('clients'), slaPolicyId: v.optional(v.id('slaPolicies')) },
  handler: async (ctx, { clientId, slaPolicyId }) => {
    await getClient(ctx, clientId);
    if (slaPolicyId) {
      const policy = await ctx.db.get('slaPolicies', slaPolicyId);
      if (!policy?.active) throw crmError('crm.invalid', 'Choose an active SLA policy');
    }
    await ctx.db.patch('clients', clientId, { slaPolicyId });
  },
});

/** Turns the client portal on or off for the whole client. Off signs every contact out at once. */
export const setPortalEnabled = teamMutation('contacts.manage')({
  args: { clientId: v.id('clients'), enabled: v.boolean() },
  handler: async (ctx, { clientId, enabled }) => {
    const client = await getClient(ctx, clientId);
    if (client.portalEnabled === enabled) return;
    await ctx.db.patch('clients', clientId, { portalEnabled: enabled });
    if (!enabled) {
      const contacts = await ctx.db
        .query('contacts')
        .withIndex('by_client', (q) => q.eq('clientId', clientId))
        .collect();
      for (const contact of contacts) if (contact.authUserId) await revokeAllSessions(ctx, contact.authUserId);
    }
    await recordActivity(ctx, {
      subject: { table: 'clients', id: clientId },
      clientId,
      type: 'system',
      title: enabled ? 'Client portal turned on' : 'Client portal turned off',
      actor: { kind: 'team', id: ctx.principal.member._id },
    });
  },
});

/**
 * Deletes a client created by mistake, with its contacts and timeline. Refused once anything depends on it (a contact
 * who has signed in to the portal; later modules add deals, projects, invoices and documents): archive it instead.
 */
export const remove = teamMutation('clients.delete')({
  args: { clientId: v.id('clients') },
  handler: async (ctx, { clientId }) => {
    await getClient(ctx, clientId);
    const contacts = await ctx.db
      .query('contacts')
      .withIndex('by_client', (q) => q.eq('clientId', clientId))
      .collect();
    if (contacts.some((contact) => contact.authUserId)) {
      throw crmError('crm.hasHistory', 'A contact has used the portal, so this client can only be archived');
    }
    const [blocker] = await dependents(ctx, clientId);
    if (blocker) throw crmError('crm.hasHistory', `This client has ${blocker}, so it can only be archived`);

    const activities = await ctx.db
      .query('activities')
      .withIndex('by_client_occurred', (q) => q.eq('clientId', clientId))
      .collect();
    for (const activity of activities) await ctx.db.delete('activities', activity._id);
    for (const contact of contacts) await ctx.db.delete('contacts', contact._id);
    await ctx.db.delete('clients', clientId);
  },
});

/** Records that stop a client being deleted. Each module that links records to clients adds its check here. */
async function dependents(ctx: Ctx, clientId: Id<'clients'>): Promise<string[]> {
  const blockers: string[] = [];
  const deal = await ctx.db
    .query('deals')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .first();
  if (deal) blockers.push('deals');
  return blockers;
}
