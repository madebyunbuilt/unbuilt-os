import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { localDateString } from './lib/businessTime';
import { teamMutation, teamQuery } from './lib/functions';
import { defaultBusinessHours, holidaysBetween } from './lib/holidays';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { type TeamPrincipal } from './lib/principals';
import { getOrgSettings } from './lib/settings';
import {
  addDays,
  canCancel,
  canDecide,
  canSeeDetails,
  formatDateRange,
  formatDays,
  optionalNote,
  timeOffError,
  TYPE_LABELS,
  validateDates,
  workingDays,
} from './lib/timeOff';

// Time off (11-team.md, Time off): requests, decisions, cancellations and the team leave calendar. The type and notes
// are private to the member and approvers; everyone else with team.view sees only that someone is off.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };

const LINK = '/team/time-off';
/** The calendar query covers at most this many days, enough for a six-week month grid. */
const MAX_CALENDAR_DAYS = 100;
const MINE_LIMIT = 100;

const timeOffType = v.union(v.literal('annual'), v.literal('sick'), v.literal('unpaid'), v.literal('other'));
const dates = { startDate: v.string(), endDate: v.string(), halfDay: v.boolean() };

async function studioToday(ctx: Ctx): Promise<string> {
  return localDateString(Date.now(), (await getOrgSettings(ctx)).timezone);
}

/** Counts working days against the default business hours and the holidays between `from` and `to`. */
async function dayCounter(ctx: Ctx, from: string, to: string) {
  const [hours, holidays] = await Promise.all([defaultBusinessHours(ctx), holidaysBetween(ctx, from, to)]);
  return (range: { startDate: string; endDate: string; halfDay: boolean }) =>
    workingDays(range, hours.weekly, holidays);
}

function memberNames(ctx: Ctx) {
  const cache = new Map<Id<'teamMembers'>, Promise<string>>();
  return (memberId: Id<'teamMembers'>) => {
    if (!cache.has(memberId)) {
      cache.set(
        memberId,
        ctx.db.get('teamMembers', memberId).then((member) => member?.name ?? 'Former member'),
      );
    }
    return cache.get(memberId)!;
  };
}

async function assertNoOverlap(
  ctx: Ctx,
  memberId: Id<'teamMembers'>,
  range: { startDate: string; endDate: string },
  statuses: Doc<'timeOff'>['status'][],
  exceptId?: Id<'timeOff'>,
) {
  const earlier = await ctx.db
    .query('timeOff')
    .withIndex('by_member_start', (q) => q.eq('memberId', memberId).lte('startDate', range.endDate))
    .collect();
  const clash = earlier.find(
    (record) => record._id !== exceptId && statuses.includes(record.status) && record.endDate >= range.startDate,
  );
  if (clash) {
    throw timeOffError(
      'timeOff.overlap',
      `This overlaps time off already ${clash.status} for ${formatDateRange(clash.startDate, clash.endDate)}`,
    );
  }
}

async function getRecord(ctx: Ctx & Principal, timeOffId: Id<'timeOff'>): Promise<Doc<'timeOff'>> {
  const record = await ctx.db.get('timeOff', timeOffId);
  // Someone who could not see the record learns nothing about it.
  if (!record || !canSeeDetails(ctx.principal, record)) throw timeOffError('timeOff.notFound', 'Time off not found');
  return record;
}

async function toView(
  ctx: Ctx & Principal,
  record: Doc<'timeOff'>,
  helpers: { name: (id: Id<'teamMembers'>) => Promise<string>; days: number; today: string },
) {
  const details = canSeeDetails(ctx.principal, record);
  return {
    id: record._id,
    memberId: record.memberId,
    memberName: await helpers.name(record.memberId),
    startDate: record.startDate,
    endDate: record.endDate,
    halfDay: record.halfDay,
    status: record.status,
    days: helpers.days,
    ...(details
      ? {
          type: record.type,
          note: record.note,
          decisionNote: record.decisionNote,
          enteredByName: record.requestedBy === record.memberId ? undefined : await helpers.name(record.requestedBy),
          decidedByName: record.decidedBy ? await helpers.name(record.decidedBy) : undefined,
          decidedAt: record.decidedAt,
        }
      : {}),
    canDecide: record.status === 'requested' && canDecide(ctx.principal, record),
    canCancel: canCancel(ctx.principal, record, helpers.today),
  };
}

async function views(ctx: Ctx & Principal, records: Doc<'timeOff'>[]) {
  if (records.length === 0) return [];
  const from = records.reduce((min, r) => (r.startDate < min ? r.startDate : min), records[0].startDate);
  const to = records.reduce((max, r) => (r.endDate > max ? r.endDate : max), records[0].endDate);
  const [count, today] = await Promise.all([dayCounter(ctx, from, to), studioToday(ctx)]);
  const name = memberNames(ctx);
  return await Promise.all(records.map((record) => toView(ctx, record, { name, days: count(record), today })));
}

/** Your own time off, newest first, and the public holidays in the coming year. */
export const mine = teamQuery('timeoff.request')({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db
      .query('timeOff')
      .withIndex('by_member_start', (q) => q.eq('memberId', ctx.principal.member._id))
      .order('desc')
      .take(MINE_LIMIT);
    const today = await studioToday(ctx);
    const holidays = await holidaysBetween(ctx, today, addDays(today, 365));
    return {
      today,
      requests: await views(ctx, records),
      upcomingHolidays: holidays.map((h) => ({ date: h.date, name: h.name, needsConfirmation: h.needsConfirmation })),
    };
  },
});

/** Requests waiting for a decision, soonest first. */
export const pending = teamQuery('timeoff.approve')({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db
      .query('timeOff')
      .withIndex('by_status_end', (q) => q.eq('status', 'requested'))
      .collect();
    records.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return await views(ctx, records);
  },
});

/**
 * The team leave calendar from `from` to `to`: approved time off for everyone, requests too for approvers (and your
 * own), the public holidays, and the working weekdays.
 */
export const calendar = teamQuery('team.view')({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    validateDates({ startDate: from, endDate: to, halfDay: false });
    if (addDays(from, MAX_CALENDAR_DAYS - 1) < to) {
      throw timeOffError('timeOff.invalid', `The calendar shows at most ${MAX_CALENDAR_DAYS} days at once`);
    }
    const overlapping = async (status: Doc<'timeOff'>['status']) =>
      (
        await ctx.db
          .query('timeOff')
          .withIndex('by_status_end', (q) => q.eq('status', status).gte('endDate', from))
          .collect()
      ).filter((record) => record.startDate <= to);

    const approver = ctx.can('timeoff.approve');
    const requested = (await overlapping('requested')).filter(
      (record) => approver || record.memberId === ctx.principal.member._id,
    );
    const records = [...(await overlapping('approved')), ...requested].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
    const [hours, holidays] = await Promise.all([defaultBusinessHours(ctx), holidaysBetween(ctx, from, to)]);
    return {
      entries: await views(ctx, records),
      holidays: holidays.map((h) => ({ date: h.date, name: h.name, needsConfirmation: h.needsConfirmation })),
      workingWeekdays: [...new Set(hours.weekly.map((w) => w.day))].sort(),
    };
  },
});

async function checkedRange(ctx: Ctx, input: { startDate: string; endDate: string; halfDay: boolean }) {
  const range = validateDates(input);
  const days = (await dayCounter(ctx, range.startDate, range.endDate))(range);
  if (days === 0) {
    throw timeOffError(
      'timeOff.noWorkingDays',
      'Those dates are all weekends or public holidays, so no time off is needed',
    );
  }
  return { range, days };
}

/** Ask for time off. Approvers are notified; nobody approves their own request except the Owner. */
export const request = teamMutation('timeoff.request')({
  args: { type: timeOffType, ...dates, note: v.optional(v.string()) },
  handler: async (ctx, { type, note, ...input }) => {
    const me = ctx.principal.member;
    const { range, days } = await checkedRange(ctx, input);
    await assertNoOverlap(ctx, me._id, range, ['requested', 'approved']);
    const id = await ctx.db.insert('timeOff', {
      memberId: me._id,
      type,
      ...range,
      status: 'requested',
      note: optionalNote(note),
      requestedBy: me._id,
    });
    const approvers = (await activeMembersWith(ctx, 'timeoff.approve')).filter((memberId) => memberId !== me._id);
    await notifyTeamMembers(ctx, approvers, {
      event: 'timeoff.requested',
      title: `${me.name} requested time off`,
      body: `${TYPE_LABELS[type]}, ${formatDateRange(range.startDate, range.endDate)} (${formatDays(days)})`,
      link: LINK,
    });
    return id;
  },
});

/** An approver records time off for someone who cannot request it, such as sick leave phoned in. It is approved at once. */
export const record = teamMutation('timeoff.approve')({
  args: { memberId: v.id('teamMembers'), type: timeOffType, ...dates, note: v.optional(v.string()) },
  handler: async (ctx, { memberId, type, note, ...input }) => {
    const member = await ctx.db.get('teamMembers', memberId);
    if (!member || member.status !== 'active') {
      throw timeOffError('timeOff.memberNotActive', 'Time off can be recorded only for active team members');
    }
    if (!canDecide(ctx.principal, { memberId })) {
      throw timeOffError('timeOff.ownRequest', 'Request your own time off so someone else can approve it');
    }
    const { range, days } = await checkedRange(ctx, input);
    await assertNoOverlap(ctx, memberId, range, ['requested', 'approved']);
    const me = ctx.principal.member;
    const id = await ctx.db.insert('timeOff', {
      memberId,
      type,
      ...range,
      status: 'approved',
      note: optionalNote(note),
      requestedBy: me._id,
      decidedBy: me._id,
      decidedAt: Date.now(),
    });
    if (memberId !== me._id) {
      await notifyTeamMembers(ctx, [memberId], {
        event: 'timeoff.recorded',
        title: `${me.name} recorded time off for you`,
        body: `${TYPE_LABELS[type]}, ${formatDateRange(range.startDate, range.endDate)} (${formatDays(days)})`,
        link: LINK,
      });
    }
    return id;
  },
});

async function decide(
  ctx: MutationCtx & Principal,
  { timeOffId, note }: { timeOffId: Id<'timeOff'>; note?: string },
  outcome: 'approved' | 'declined',
) {
  const record = await getRecord(ctx, timeOffId);
  if (record.status !== 'requested') {
    throw timeOffError('timeOff.alreadyDecided', `This request is already ${record.status}`);
  }
  if (!canDecide(ctx.principal, record)) {
    throw timeOffError('timeOff.ownRequest', 'Someone else must decide your own time off');
  }
  if (outcome === 'approved') await assertNoOverlap(ctx, record.memberId, record, ['approved'], record._id);
  const me = ctx.principal.member;
  const decisionNote = optionalNote(note, 'Decision note');
  await ctx.db.patch('timeOff', timeOffId, { status: outcome, decidedBy: me._id, decidedAt: Date.now(), decisionNote });
  if (record.memberId !== me._id) {
    await notifyTeamMembers(ctx, [record.memberId], {
      event: 'timeoff.decided',
      title: `Your time off was ${outcome}`,
      body: `${formatDateRange(record.startDate, record.endDate)}, by ${me.name}.${decisionNote ? ` ${decisionNote}` : ''}`,
      link: LINK,
    });
  }
}

const decision = { timeOffId: v.id('timeOff'), note: v.optional(v.string()) };

export const approve = teamMutation('timeoff.approve')({
  args: decision,
  handler: (ctx, args) => decide(ctx, args, 'approved'),
});

export const decline = teamMutation('timeoff.approve')({
  args: decision,
  handler: (ctx, args) => decide(ctx, args, 'declined'),
});

/**
 * Cancel requested or approved time off. Whether the caller may depends on whose it is (see `canCancel`): members cancel
 * their own, approved time off only before it starts; approvers cancel anyone else's. Hence no single permission here.
 */
export const cancel = teamMutation(null)({
  args: { timeOffId: v.id('timeOff') },
  handler: async (ctx, { timeOffId }) => {
    const record = await getRecord(ctx, timeOffId);
    const today = await studioToday(ctx);
    if (record.status !== 'requested' && record.status !== 'approved') {
      throw timeOffError('timeOff.notOpen', `This time off is already ${record.status}`);
    }
    if (!canCancel(ctx.principal, record, today)) {
      throw timeOffError(
        'timeOff.started',
        record.memberId === ctx.principal.member._id
          ? 'This time off has started. Ask an approver to cancel it.'
          : 'Only approvers can cancel someone else’s time off',
      );
    }
    const me = ctx.principal.member;
    await ctx.db.patch('timeOff', timeOffId, { status: 'cancelled', cancelledBy: me._id, cancelledAt: Date.now() });

    const range = formatDateRange(record.startDate, record.endDate);
    if (record.memberId !== me._id) {
      await notifyTeamMembers(ctx, [record.memberId], {
        event: 'timeoff.cancelled',
        title: 'Your time off was cancelled',
        body: `${range}, by ${me.name}`,
        link: LINK,
      });
    } else if (record.status === 'approved' && record.decidedBy && record.decidedBy !== me._id) {
      await notifyTeamMembers(ctx, [record.decidedBy], {
        event: 'timeoff.cancelled',
        title: `${me.name} cancelled their time off`,
        body: range,
        link: LINK,
      });
    }
  },
});
