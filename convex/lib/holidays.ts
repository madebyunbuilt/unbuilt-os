import { ConvexError } from 'convex/values';
import { type Doc } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type BusinessCalendar, DEFAULT_BUSINESS_CALENDAR } from './businessTime';
import { authError, type TeamPrincipal } from './principals';
import { FIXED_HOLIDAYS, MOVABLE_HOLIDAY_ESTIMATES } from './seedData';

// Public holidays and the default business calendar (09-support-and-sla.md, Business hours and holidays), shared by the
// seed, settings, time off and the January reminder.

type Ctx = QueryCtx | MutationCtx;

export function calendarError(code: `holidays.${string}` | `businessHours.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** Business hours and holidays are read by settings.manage and sla.manage (SLA timers depend on them). */
export function assertCanViewCalendar(principal: TeamPrincipal): void {
  if (!principal.permissions.has('settings.manage') && !principal.permissions.has('sla.manage')) {
    throw authError('auth.forbidden', 'Your role cannot view business hours and holidays');
  }
}

/** Holidays dated from `from` to `to` inclusive (YYYY-MM-DD), in date order. */
export async function holidaysBetween(ctx: Ctx, from: string, to: string): Promise<Doc<'holidays'>[]> {
  return await ctx.db
    .query('holidays')
    .withIndex('by_date', (q) => q.gte('date', from).lte('date', to))
    .collect();
}

export async function holidaysInYear(ctx: Ctx, year: number): Promise<Doc<'holidays'>[]> {
  return await holidaysBetween(ctx, `${year}-01-01`, `${year}-12-31`);
}

/** The default calendar row, or the built-in default before the seed has run. */
export async function defaultBusinessHours(
  ctx: Ctx,
): Promise<(BusinessCalendar & { _id?: Doc<'businessHours'>['_id'] }) & { name: string }> {
  const row = await ctx.db
    .query('businessHours')
    .withIndex('by_default', (q) => q.eq('isDefault', true))
    .first();
  return row ?? { name: 'Studio hours', ...DEFAULT_BUSINESS_CALENDAR };
}

/**
 * Adds the seeded holidays each year needs and never touches rows that exist. A holiday is matched by name within its
 * year, so a movable holiday whose date was confirmed is not added again at its estimated date.
 */
export async function ensureSeededHolidays(db: MutationCtx['db'], years: number[]) {
  let created = 0;
  const yearsWithoutEstimates: number[] = [];
  for (const year of years) {
    const movable = MOVABLE_HOLIDAY_ESTIMATES[year];
    if (!movable) yearsWithoutEstimates.push(year);
    const names = new Set((await holidaysInYear({ db } as Ctx, year)).map((holiday) => holiday.name));
    const rows = [
      ...FIXED_HOLIDAYS.map((h) => ({ date: `${year}-${h.monthDay}`, name: h.name, needsConfirmation: false })),
      ...(movable ?? []).map((h) => ({ ...h, needsConfirmation: true })),
    ];
    for (const row of rows) {
      if (names.has(row.name)) continue;
      await db.insert('holidays', { ...row, country: 'NG', recurring: false, source: 'seed' });
      created++;
    }
  }
  return { created, yearsWithoutEstimates };
}
