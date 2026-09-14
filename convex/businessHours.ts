import { v } from 'convex/values';
import { assertValidCalendar, BusinessTimeError } from './lib/businessTime';
import { teamMutation, teamQuery } from './lib/functions';
import { assertCanViewCalendar, calendarError, defaultBusinessHours } from './lib/holidays';
import { isTimeZone } from './lib/validation';

// The studio's default business hours (09-support-and-sla.md, Business hours and holidays). They decide SLA due times
// and which days time off counts. Everyone with settings.manage or sla.manage can see them; settings.manage edits them.

const MAX_NAME_LENGTH = 80;

export const get = teamQuery(null)({
  args: {},
  handler: async (ctx) => {
    assertCanViewCalendar(ctx.principal);
    const hours = await defaultBusinessHours(ctx);
    return {
      name: hours.name,
      timezone: hours.timezone,
      weekly: hours.weekly.map(({ day, start, end }) => ({ day, start, end })),
      canEdit: ctx.can('settings.manage'),
    };
  },
});

export const update = teamMutation('settings.manage')({
  args: {
    name: v.string(),
    timezone: v.string(),
    weekly: v.array(v.object({ day: v.number(), start: v.string(), end: v.string() })),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw calendarError('businessHours.invalid', `Name the calendar in at most ${MAX_NAME_LENGTH} characters`);
    }
    if (!isTimeZone(args.timezone))
      throw calendarError('businessHours.invalid', `"${args.timezone}" is not a timezone`);
    const weekly = [...args.weekly].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
    const calendar = { timezone: args.timezone, weekly };
    try {
      assertValidCalendar(calendar);
    } catch (error) {
      if (error instanceof BusinessTimeError) throw calendarError('businessHours.invalid', error.data.message);
      throw error;
    }

    const existing = await ctx.db
      .query('businessHours')
      .withIndex('by_default', (q) => q.eq('isDefault', true))
      .first();
    if (existing) {
      await ctx.db.patch('businessHours', existing._id, { name, ...calendar });
    } else {
      await ctx.db.insert('businessHours', { name, ...calendar, isDefault: true });
    }
  },
});
