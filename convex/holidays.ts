import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { auditedDatabase } from './lib/audit';
import { localDateString } from './lib/businessTime';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { assertCanViewCalendar, calendarError, ensureSeededHolidays, holidaysInYear } from './lib/holidays';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { getOrgSettings } from './lib/settings';
import { isIsoDate } from './lib/validation';

// Public holidays (09-support-and-sla.md, Business hours and holidays; 11-team.md). Everyone with settings.manage or
// sla.manage can see them; only settings.manage changes them. Saving a holiday confirms its date.

const MAX_NAME_LENGTH = 80;
const SETTINGS_LINK = '/settings/business-hours';

function view(holiday: Doc<'holidays'>) {
  return {
    id: holiday._id,
    date: holiday.date,
    name: holiday.name,
    source: holiday.source,
    needsConfirmation: holiday.needsConfirmation,
  };
}

function checkedName(value: string): string {
  const name = value.trim();
  if (!name) throw calendarError('holidays.invalid', 'Name the holiday');
  if (name.length > MAX_NAME_LENGTH) {
    throw calendarError('holidays.invalid', `The name can be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function checkedDate(value: string): string {
  if (!isIsoDate(value)) throw calendarError('holidays.invalid', 'Choose a date');
  return value;
}

/** One holiday per name per year, so the seed and the January job recognise a movable holiday after its date moves. */
async function assertUniqueName(ctx: MutationCtx, date: string, name: string, exceptId?: Id<'holidays'>) {
  const year = Number(date.slice(0, 4));
  const sameName = (await holidaysInYear(ctx, year)).find(
    (holiday) => holiday._id !== exceptId && holiday.name.toLowerCase() === name.toLowerCase(),
  );
  if (sameName) {
    throw calendarError(
      'holidays.duplicate',
      `${year} already has ${sameName.name} on ${sameName.date}. For an extra day, use a name like "${name} (second day)".`,
    );
  }
}

export const list = teamQuery(null)({
  args: { year: v.number() },
  handler: async (ctx, { year }) => {
    assertCanViewCalendar(ctx.principal);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw calendarError('holidays.invalid', 'Choose a year');
    return {
      holidays: (await holidaysInYear(ctx, year)).map(view),
      canEdit: ctx.can('settings.manage'),
    };
  },
});

/** Adds a holiday the government declared. */
export const add = teamMutation('settings.manage')({
  args: { date: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const date = checkedDate(args.date);
    const name = checkedName(args.name);
    await assertUniqueName(ctx, date, name);
    const { country } = await getOrgSettings(ctx);
    return await ctx.db.insert('holidays', {
      date,
      name,
      country,
      recurring: false,
      source: 'manual',
      needsConfirmation: false,
    });
  },
});

/** Changes a holiday's date or name and confirms it. The date stays in the same year. */
export const update = teamMutation('settings.manage')({
  args: { holidayId: v.id('holidays'), date: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const holiday = await ctx.db.get('holidays', args.holidayId);
    if (!holiday) throw calendarError('holidays.notFound', 'Holiday not found');
    const date = checkedDate(args.date);
    const name = checkedName(args.name);
    if (date.slice(0, 4) !== holiday.date.slice(0, 4)) {
      throw calendarError('holidays.invalid', `Choose a date in ${holiday.date.slice(0, 4)}`);
    }
    await assertUniqueName(ctx, date, name, holiday._id);
    await ctx.db.patch('holidays', holiday._id, { date, name, needsConfirmation: false });
  },
});

/** Removes a holiday added by hand. Seeded holidays are public holidays in law; move their date instead. */
export const remove = teamMutation('settings.manage')({
  args: { holidayId: v.id('holidays') },
  handler: async (ctx, { holidayId }) => {
    const holiday = await ctx.db.get('holidays', holidayId);
    if (!holiday) throw calendarError('holidays.notFound', 'Holiday not found');
    if (holiday.source !== 'manual') {
      throw calendarError('holidays.seeded', 'Standard public holidays cannot be removed. Change the date instead.');
    }
    await ctx.db.delete('holidays', holidayId);
  },
});

/**
 * Runs in early January (convex/crons.ts): adds the standard holidays for this year and next, then asks everyone with
 * settings.manage to confirm this year's movable holidays.
 */
export const januaryReminder = internalMutation({
  args: {},
  handler: async (ctx) => {
    const db = auditedDatabase(ctx.db, { actorKind: 'system', permission: 'holidays.januaryReminder' });
    const { timezone } = await getOrgSettings(ctx);
    const year = Number(localDateString(Date.now(), timezone).slice(0, 4));
    const { yearsWithoutEstimates } = await ensureSeededHolidays(db, [year, year + 1]);

    const estimates = (await holidaysInYear(ctx, year)).filter((holiday) => holiday.needsConfirmation);
    const body = yearsWithoutEstimates.includes(year)
      ? `There are no estimates for ${year}. Add Good Friday, Easter Monday, Eid al-Fitr, Eid al-Adha and Mawlid once they are declared.`
      : estimates.length > 0
        ? `${estimates.map((h) => h.name).join(', ')} are estimates. Confirm the declared dates.`
        : null;
    if (!body) return { notified: 0 };

    const admins = await activeMembersWith(ctx, 'settings.manage');
    await notifyTeamMembers({ db }, admins, {
      event: 'holidays.confirm',
      title: `Confirm the ${year} public holidays`,
      body,
      link: SETTINGS_LINK,
    });
    return { notified: admins.length };
  },
});
