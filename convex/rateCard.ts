import { v } from 'convex/values';
import { type Doc } from './_generated/dataModel';
import { crmError, text } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';

// The rate card (05-crm.md, Rate card): services with a unit and a price per currency. Items are never deleted, so
// documents that used them keep their meaning; inactive items cannot be added to new documents.

const currency = v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'));
const unit = v.union(v.literal('fixed'), v.literal('hour'), v.literal('day'), v.literal('week'), v.literal('month'));

function view(item: Doc<'rateCardItems'>) {
  return {
    id: item._id,
    name: item.name,
    description: item.description,
    serviceSlug: item.serviceSlug,
    unit: item.unit,
    prices: item.prices,
    taxable: item.taxable,
    active: item.active,
    category: item.category,
  };
}

export const list = teamQuery('ratecard.view')({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { includeInactive }) => {
    const items = includeInactive
      ? await ctx.db.query('rateCardItems').withIndex('by_name').collect()
      : await ctx.db
          .query('rateCardItems')
          .withIndex('by_active_name', (q) => q.eq('active', true))
          .collect();
    return items.map(view);
  },
});

const fields = {
  name: v.string(),
  description: v.optional(v.string()),
  serviceSlug: v.optional(v.string()),
  unit,
  prices: v.array(v.object({ currency, unitPriceMinor: v.number() })),
  taxable: v.boolean(),
  category: v.optional(v.string()),
};

function checked(args: {
  name: string;
  description?: string;
  serviceSlug?: string;
  unit: Doc<'rateCardItems'>['unit'];
  prices: Doc<'rateCardItems'>['prices'];
  taxable: boolean;
  category?: string;
}) {
  const seen = new Set<string>();
  for (const price of args.prices) {
    if (seen.has(price.currency)) throw crmError('crm.invalid', `Enter one ${price.currency} price`);
    seen.add(price.currency);
    if (!Number.isSafeInteger(price.unitPriceMinor) || price.unitPriceMinor < 0) {
      throw crmError('crm.invalid', 'Prices must be whole, non-negative amounts in minor units');
    }
  }
  const slug = text(args.serviceSlug, 'Service', { max: 80 });
  if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw crmError('crm.invalid', 'The service must be a slug, such as web-platforms');
  }
  return {
    name: text(args.name, 'Name', { required: true, max: 120 })!,
    description: text(args.description, 'Description', { max: 1000 }),
    serviceSlug: slug,
    unit: args.unit,
    prices: [...args.prices].sort((a, b) => a.currency.localeCompare(b.currency)),
    taxable: args.taxable,
    category: text(args.category, 'Category', { max: 60 }),
  };
}

export const create = teamMutation('ratecard.manage')({
  args: fields,
  handler: async (ctx, args) => await ctx.db.insert('rateCardItems', { ...checked(args), active: true }),
});

/** Changes apply to documents created afterwards; existing documents keep the prices they were given. */
export const update = teamMutation('ratecard.manage')({
  args: { itemId: v.id('rateCardItems'), ...fields },
  handler: async (ctx, { itemId, ...args }) => {
    if (!(await ctx.db.get('rateCardItems', itemId))) throw crmError('crm.notFound', 'Rate card item not found');
    await ctx.db.patch('rateCardItems', itemId, checked(args));
  },
});

export const setActive = teamMutation('ratecard.manage')({
  args: { itemId: v.id('rateCardItems'), active: v.boolean() },
  handler: async (ctx, { itemId, active }) => {
    if (!(await ctx.db.get('rateCardItems', itemId))) throw crmError('crm.notFound', 'Rate card item not found');
    await ctx.db.patch('rateCardItems', itemId, { active });
  },
});
