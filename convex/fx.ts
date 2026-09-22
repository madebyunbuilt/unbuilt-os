import { v } from 'convex/values';
import { FX_RATE_MAX_AGE_DAYS, addDays, invoiceError, studioToday } from './lib/invoices';
import { MICRO_PER_UNIT } from './lib/money';
import { teamMutation, teamQuery } from './lib/functions';
import { isIsoDate } from './lib/validation';

// Foreign exchange (08-billing-and-finance.md, Foreign exchange). Rates are entered by hand, one per currency per day,
// as NGN per one unit. Invoices store the rate they were sent with, so changing a rate never changes a past total.

const fxCurrency = v.union(v.literal('USD'), v.literal('EUR'));

/** The latest rates, and whether each is recent enough to send an invoice with. */
export const current = teamQuery(null)({
  args: {},
  handler: async (ctx) => {
    const today = await studioToday(ctx);
    const freshFrom = addDays(today, -FX_RATE_MAX_AGE_DAYS);
    const latest = async (currency: 'USD' | 'EUR') => {
      const row = await ctx.db
        .query('fxRates')
        .withIndex('by_currency_date', (q) => q.eq('currency', currency))
        .order('desc')
        .first();
      return {
        currency,
        date: row?.date,
        rateToNgnMicro: row?.rateToNgnMicro,
        fresh: row !== null && row.date >= freshFrom,
      };
    };
    return [await latest('USD'), await latest('EUR')];
  },
});

export const history = teamQuery('fx.manage')({
  args: { currency: fxCurrency },
  handler: async (ctx, { currency }) => {
    const rows = await ctx.db
      .query('fxRates')
      .withIndex('by_currency_date', (q) => q.eq('currency', currency))
      .order('desc')
      .take(60);
    return rows.map((row) => ({ id: row._id, date: row.date, rateToNgnMicro: row.rateToNgnMicro }));
  },
});

/** Sets the rate for a day, replacing that day's rate if one was already entered. */
export const setRate = teamMutation('fx.manage')({
  args: { currency: fxCurrency, date: v.string(), rateToNgnMicro: v.number() },
  handler: async (ctx, { currency, date, rateToNgnMicro }) => {
    if (!isIsoDate(date)) throw invoiceError('invoices.invalid', 'The date must be a date');
    if (date > (await studioToday(ctx)))
      throw invoiceError('invoices.invalid', 'A rate cannot be set for a future day');
    // Between ₦0.000001 and ₦1,000,000 per unit: anything outside is a typing mistake.
    if (!Number.isSafeInteger(rateToNgnMicro) || rateToNgnMicro <= 0 || rateToNgnMicro > 1_000_000 * MICRO_PER_UNIT) {
      throw invoiceError('invoices.invalid', 'The rate must be a positive number of naira per unit');
    }
    const existing = await ctx.db
      .query('fxRates')
      .withIndex('by_currency_date', (q) => q.eq('currency', currency).eq('date', date))
      .unique();
    if (existing) {
      await ctx.db.patch('fxRates', existing._id, { rateToNgnMicro, enteredByMemberId: ctx.principal.member._id });
      return existing._id;
    }
    return await ctx.db.insert('fxRates', {
      currency,
      date,
      rateToNgnMicro,
      source: 'manual',
      enteredByMemberId: ctx.principal.member._id,
    });
  },
});
