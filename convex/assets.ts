import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import {
  assetError,
  AUTO_INVOICE_DAYS,
  daysUntil,
  nextYear,
  remindersDue,
  renewalSummary,
  tellsClient,
} from './lib/assets';
import { getClient, recordActivity, text } from './lib/crm';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { draftInvoice, studioToday } from './lib/invoices';
import { activeMembersWith, notifyClientContacts, notifyTeamMembers } from './lib/notify';

// Managed assets and renewals (09-support-and-sla.md). A domain that lapses takes a client's site with it, so the
// whole point of this module is that nobody finds out on the day.

const assetType = v.union(
  v.literal('domain'),
  v.literal('hosting'),
  v.literal('ssl'),
  v.literal('app_store_account'),
  v.literal('subscription'),
  v.literal('other'),
);

const currency = v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'));

function view(asset: Doc<'managedAssets'>, today: string) {
  return {
    id: asset._id,
    clientId: asset.clientId,
    projectId: asset.projectId,
    type: asset.type,
    name: asset.name,
    provider: asset.provider,
    renewsOnDate: asset.renewsOnDate,
    daysUntilRenewal: daysUntil(asset.renewsOnDate, today),
    costMinor: asset.costMinor,
    costCurrency: asset.costCurrency,
    billPriceMinor: asset.billPriceMinor,
    billCurrency: asset.billCurrency,
    autoInvoice: asset.autoInvoice,
    renewalInvoiceId: asset.renewalInvoiceId,
    status: asset.status,
    notes: asset.notes,
  };
}

async function getAsset(ctx: QueryCtx | MutationCtx, assetId: Id<'managedAssets'>): Promise<Doc<'managedAssets'>> {
  const asset = await ctx.db.get('managedAssets', assetId);
  if (!asset) throw assetError('assets.notFound', 'That asset is not here');
  return asset;
}

/** What the client pays, where the studio bills it on at all. Both halves move together or neither does. */
function checkedPrice(billPriceMinor: number | undefined, billCurrency: Doc<'managedAssets'>['billCurrency']) {
  if (billPriceMinor === undefined && billCurrency === undefined) return {};
  if (billPriceMinor === undefined || billCurrency === undefined) {
    throw assetError('assets.invalid', 'Give the price and the currency together, or neither');
  }
  if (billPriceMinor < 0) throw assetError('assets.invalid', 'A price cannot be less than nothing');
  return { billPriceMinor, billCurrency };
}

export const list = teamQuery('assets.manage')({
  args: { clientId: v.optional(v.id('clients')), status: v.optional(v.union(v.literal('active'), v.literal('all'))) },
  handler: async (ctx, { clientId, status = 'active' }) => {
    const today = await studioToday(ctx);
    const assets = clientId
      ? await ctx.db
          .query('managedAssets')
          .withIndex('by_client', (q) => q.eq('clientId', clientId))
          .collect()
      : await ctx.db.query('managedAssets').take(1000);
    const wanted = assets.filter((asset) => status === 'all' || asset.status === 'active');
    return await Promise.all(
      wanted
        // Soonest first: this list exists to answer "what is about to lapse".
        .sort((a, b) => a.renewsOnDate.localeCompare(b.renewsOnDate))
        .map(async (asset) => ({
          ...view(asset, today),
          clientName: (await ctx.db.get('clients', asset.clientId))?.displayName ?? 'Unknown client',
        })),
    );
  },
});

export const get = teamQuery('assets.manage')({
  args: { assetId: v.id('managedAssets') },
  handler: async (ctx, { assetId }) => {
    const asset = await ctx.db.get('managedAssets', assetId);
    if (!asset) return null;
    const today = await studioToday(ctx);
    return {
      ...view(asset, today),
      clientName: (await ctx.db.get('clients', asset.clientId))?.displayName ?? 'Unknown client',
      remindersSent: asset.remindersSent,
      suggestedNextDate: nextYear(asset.renewsOnDate),
    };
  },
});

const assetFields = {
  projectId: v.optional(v.id('projects')),
  type: assetType,
  name: v.string(),
  provider: v.string(),
  renewsOnDate: v.string(),
  costMinor: v.number(),
  costCurrency: currency,
  billPriceMinor: v.optional(v.number()),
  billCurrency: v.optional(currency),
  autoInvoice: v.boolean(),
  notes: v.optional(v.string()),
};

function checkedDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw assetError('assets.invalid', 'A renewal date reads as YYYY-MM-DD');
  return value;
}

export const create = teamMutation('assets.manage')({
  args: { clientId: v.id('clients'), ...assetFields },
  handler: async (ctx, { clientId, ...args }) => {
    await getClient(ctx, clientId);
    if (args.projectId) {
      const project = await ctx.db.get('projects', args.projectId);
      if (!project || project.clientId !== clientId) {
        throw assetError('assets.invalid', 'That project does not belong to this client');
      }
    }
    if (args.costMinor < 0) throw assetError('assets.invalid', 'A cost cannot be less than nothing');
    const price = checkedPrice(args.billPriceMinor, args.billCurrency);
    if (args.autoInvoice && price.billPriceMinor === undefined) {
      throw assetError('assets.invalid', 'An asset cannot be invoiced automatically without a price to invoice');
    }

    return await ctx.db.insert('managedAssets', {
      clientId,
      projectId: args.projectId,
      type: args.type,
      name: text(args.name, 'Name', { required: true, max: 120 })!,
      provider: text(args.provider, 'Provider', { required: true, max: 120 })!,
      renewsOnDate: checkedDate(args.renewsOnDate),
      costMinor: args.costMinor,
      costCurrency: args.costCurrency,
      ...price,
      autoInvoice: args.autoInvoice,
      remindersSent: [],
      status: 'active',
      notes: text(args.notes, 'Notes', { max: 2000 }),
      createdByMemberId: ctx.principal.member._id,
    });
  },
});

export const update = teamMutation('assets.manage')({
  args: { assetId: v.id('managedAssets'), ...assetFields },
  handler: async (ctx, { assetId, ...args }) => {
    const asset = await getAsset(ctx, assetId);
    if (asset.status !== 'active') {
      throw assetError('assets.closed', `This asset is ${asset.status} and is no longer the studio's to change`);
    }
    const price = checkedPrice(args.billPriceMinor, args.billCurrency);
    if (args.autoInvoice && price.billPriceMinor === undefined) {
      throw assetError('assets.invalid', 'An asset cannot be invoiced automatically without a price to invoice');
    }
    const renewsOnDate = checkedDate(args.renewsOnDate);

    await ctx.db.patch('managedAssets', assetId, {
      projectId: args.projectId,
      type: args.type,
      name: text(args.name, 'Name', { required: true, max: 120 })!,
      provider: text(args.provider, 'Provider', { required: true, max: 120 })!,
      renewsOnDate,
      costMinor: args.costMinor,
      costCurrency: args.costCurrency,
      billPriceMinor: price.billPriceMinor,
      billCurrency: price.billCurrency,
      autoInvoice: args.autoInvoice,
      notes: text(args.notes, 'Notes', { max: 2000 }),
      // A moved date is a different renewal, so what was already said about the old one does not count against it.
      ...(renewsOnDate === asset.renewsOnDate ? {} : { remindersSent: [], overdueAlertedOn: undefined }),
    });
  },
});

/**
 * Saying it has been renewed. The next date is given rather than assumed: a domain runs a year, hosting a month, and
 * a certificate whatever it was bought for — guessing would put a wrong date in front of somebody who trusted it.
 */
export const markRenewed = teamMutation('assets.manage')({
  args: { assetId: v.id('managedAssets'), nextRenewsOnDate: v.string() },
  handler: async (ctx, { assetId, nextRenewsOnDate }) => {
    const asset = await getAsset(ctx, assetId);
    const next = checkedDate(nextRenewsOnDate);
    if (next <= asset.renewsOnDate) {
      throw assetError('assets.invalid', 'The next renewal has to be after this one');
    }
    await ctx.db.patch('managedAssets', assetId, {
      renewsOnDate: next,
      // A new renewal is told about from scratch, and drafts its own invoice when the time comes.
      remindersSent: [],
      renewalInvoiceId: undefined,
      overdueAlertedOn: undefined,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: asset.clientId },
      clientId: asset.clientId,
      type: 'system',
      title: `${asset.name} renewed, next on ${next}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { assetId },
    });
  },
});

/** Handing it over, or letting it go. Either way the studio stops being the one who remembers. */
export const close = teamMutation('assets.manage')({
  args: {
    assetId: v.id('managedAssets'),
    status: v.union(v.literal('transferred'), v.literal('cancelled')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { assetId, status, note }) => {
    const asset = await getAsset(ctx, assetId);
    await ctx.db.patch('managedAssets', assetId, { status });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: asset.clientId },
      clientId: asset.clientId,
      type: 'system',
      title:
        status === 'transferred'
          ? `${asset.name} transferred to the client; Unbuilt no longer renews it`
          : `${asset.name} cancelled`,
      body: text(note, 'Note', { max: 500 }),
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { assetId },
    });
  },
});

/** The client's people who are told about money: billing contacts, or everybody with portal access if none is named. */
async function billingContacts(ctx: MutationCtx, clientId: Id<'clients'>): Promise<Id<'contacts'>[]> {
  const contacts = await ctx.db
    .query('contacts')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  const active = contacts.filter((contact) => contact.status === 'active' && contact.portalAccess);
  const billing = active.filter((contact) => contact.isBilling);
  return (billing.length > 0 ? billing : active).map((contact) => contact._id);
}

/**
 * The day's renewal reminders. Each threshold fires once per renewal date; from thirty days out the client's billing
 * contacts hear about it too, and `autoInvoice` drafts the invoice so it is ready rather than remembered.
 */
export const remindRenewals = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ reminded: number; drafted: number }> => {
    const today = await studioToday(ctx);
    const assets = await ctx.db
      .query('managedAssets')
      .withIndex('by_status_renews', (q) => q.eq('status', 'active'))
      .collect();

    let reminded = 0;
    let drafted = 0;
    for (const asset of assets) {
      const due = remindersDue(asset, today);
      if (due.length === 0) continue;
      const days = daysUntil(asset.renewsOnDate, today);
      const summary = renewalSummary(asset, days);

      // Only the closest threshold is worth a message; the wider ones are marked as passed without a second notice.
      const closest = Math.min(...due);
      const manager = asset.projectId ? (await ctx.db.get('projects', asset.projectId))?.managerMemberId : undefined;
      await notifyTeamMembers(ctx, manager ? [manager] : await activeMembersWith(ctx, 'assets.manage'), {
        event: 'asset.renewal',
        title: summary,
        body: `${asset.provider} · ${asset.costMinor === 0 ? 'no cost recorded' : 'see the asset for what it costs'}`,
        link: `/support/assets/${asset._id}`,
      });

      let renewalInvoiceId = asset.renewalInvoiceId;
      if (asset.autoInvoice && renewalInvoiceId === undefined && days <= AUTO_INVOICE_DAYS) {
        renewalInvoiceId = await draftInvoice(ctx, {
          clientId: asset.clientId,
          projectId: asset.projectId,
          currency: asset.billCurrency,
          createdByMemberId: asset.createdByMemberId,
          lineItems: [
            {
              description: `${asset.name} renewal (${asset.provider}), ${asset.renewsOnDate}`,
              quantityMilli: 1_000,
              unitPriceMinor: asset.billPriceMinor ?? 0,
              amountMinor: asset.billPriceMinor ?? 0,
              taxable: true,
            },
          ],
        });
        drafted++;
      }

      if (tellsClient(closest)) {
        await notifyClientContacts(ctx, await billingContacts(ctx, asset.clientId), {
          event: 'asset.renewal',
          title: summary,
          body: 'Unbuilt renews this for you. Nothing is needed from you unless you would rather it lapsed.',
          link: '/invoices',
        });
      }

      await ctx.db.patch('managedAssets', asset._id, {
        remindersSent: [...asset.remindersSent, ...due],
        renewalInvoiceId,
      });
      reminded++;
    }
    return { reminded, drafted };
  },
});

/** Anything past its date that nobody has said is renewed. Told daily, because a lapsed domain gets worse each day. */
export const alertOverdue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ overdue: number }> => {
    const today = await studioToday(ctx);
    const assets = await ctx.db
      .query('managedAssets')
      .withIndex('by_status_renews', (q) => q.eq('status', 'active').lt('renewsOnDate', today))
      .collect();

    const admins = await activeMembersWith(ctx, 'settings.manage');
    let overdue = 0;
    for (const asset of assets) {
      // Once a day, not once a run.
      if (asset.overdueAlertedOn === today) continue;
      const late = -daysUntil(asset.renewsOnDate, today);
      await notifyTeamMembers(ctx, admins, {
        event: 'asset.overdue',
        title: `${asset.name} should have been renewed on ${asset.renewsOnDate}`,
        body: `${late} day${late === 1 ? '' : 's'} ago, and nobody has said it was. ${asset.provider}.`,
        link: `/support/assets/${asset._id}`,
      });
      await ctx.db.patch('managedAssets', asset._id, { overdueAlertedOn: today });
      overdue++;
    }
    return { overdue };
  },
});
