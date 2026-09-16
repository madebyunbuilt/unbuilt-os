import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { localDateString } from './lib/businessTime';
import { text } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { isOwner } from './lib/team';
import { type TeamPermission } from './lib/permissions';
import { type TeamPrincipal } from './lib/principals';
import { notFound, projectError, visibleProject, visibleProjectIds } from './lib/projects';
import { getOrgSettings } from './lib/settings';
import {
  canApprove,
  canEditEntry,
  checkedMinutes,
  LOCKED_STATUSES,
  MAX_TIMER_MINUTES,
  ratesFor,
  timeError,
  weekStartOf,
} from './lib/time';
import { isIsoDate } from './lib/validation';

// Time tracking (06-projects.md, Time tracking): logging, the header timer, weekly submission and approval. Entries
// carry the rates that applied when they were logged; rates are returned only with team.rates.sensitive.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal; can: (permission: TeamPermission) => boolean };

async function studioToday(ctx: Ctx) {
  return localDateString(Date.now(), (await getOrgSettings(ctx)).timezone);
}

function checkedDate(value: string) {
  if (!isIsoDate(value)) throw timeError('time.invalid', 'Choose a date');
  return value;
}

async function entryView(ctx: Ctx & Principal, entry: Doc<'timeEntries'>) {
  const [member, project, task, approver] = await Promise.all([
    ctx.db.get('teamMembers', entry.memberId),
    ctx.db.get('projects', entry.projectId),
    entry.taskId ? ctx.db.get('tasks', entry.taskId) : null,
    entry.approvedBy ? ctx.db.get('teamMembers', entry.approvedBy) : null,
  ]);
  const owner = isOwner(ctx.principal.role);
  const seesRates = ctx.can('team.rates.sensitive');
  return {
    id: entry._id,
    memberId: entry.memberId,
    memberName: member?.name ?? 'Former member',
    projectId: entry.projectId,
    projectCode: project?.code,
    projectName: project?.name,
    taskId: entry.taskId,
    taskTitle: task?.title,
    date: entry.date,
    weekStart: entry.weekStart,
    minutes: entry.minutes,
    description: entry.description,
    billable: entry.billable,
    status: entry.status,
    returnedNote: entry.returnedNote,
    approvedByName: approver?.name,
    approvedAt: entry.approvedAt,
    // Finance needs to see which entries have no rate before invoicing time and materials.
    missingRates: entry.billRateMinor === undefined || entry.costRateMinor === undefined,
    ...(seesRates
      ? { costRateMinor: entry.costRateMinor, billRateMinor: entry.billRateMinor, rateCurrency: entry.rateCurrency }
      : {}),
    canEdit: await canEditEntry(ctx, ctx.principal, entry, owner),
    canDecide: entry.status === 'submitted' && (await canApprove(ctx, ctx.principal, entry, owner)),
  };
}

async function getEntry(ctx: Ctx, entryId: Id<'timeEntries'>) {
  const entry = await ctx.db.get('timeEntries', entryId);
  if (!entry) throw notFound('Time entry');
  return entry;
}

/** Your own entries for a week, with the week's totals. */
export const myWeek = teamQuery('time.log.own')({
  args: { weekStart: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const weekStart = args.weekStart ? weekStartOf(checkedDate(args.weekStart)) : weekStartOf(await studioToday(ctx));
    const entries = await ctx.db
      .query('timeEntries')
      .withIndex('by_member_week', (q) => q.eq('memberId', ctx.principal.member._id).eq('weekStart', weekStart))
      .collect();
    entries.sort((a, b) => a.date.localeCompare(b.date));
    const totals = entries.reduce(
      (sum, entry) => ({
        minutes: sum.minutes + entry.minutes,
        billableMinutes: sum.billableMinutes + (entry.billable ? entry.minutes : 0),
        draft: sum.draft + (entry.status === 'draft' ? 1 : 0),
      }),
      { minutes: 0, billableMinutes: 0, draft: 0 },
    );
    return {
      weekStart,
      today: await studioToday(ctx),
      totals,
      entries: await Promise.all(entries.map((entry) => entryView(ctx, entry))),
    };
  },
});

/** A project's time, for time.view.all; anyone else sees only their own entries on it. */
export const listForProject = teamQuery(null)({
  args: { projectId: v.id('projects'), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { projectId, from, to }) => {
    await visibleProject(ctx, ctx.principal, projectId);
    const entries = await ctx.db
      .query('timeEntries')
      .withIndex('by_project_date', (q) => q.eq('projectId', projectId))
      .collect();
    const mine = !ctx.can('time.view.all');
    const filtered = entries.filter(
      (entry) =>
        (!mine || entry.memberId === ctx.principal.member._id) &&
        (!from || entry.date >= from) &&
        (!to || entry.date <= to),
    );
    filtered.sort((a, b) => b.date.localeCompare(a.date));
    const minutes = filtered.reduce((sum, entry) => sum + entry.minutes, 0);
    const billableMinutes = filtered.reduce((sum, entry) => sum + (entry.billable ? entry.minutes : 0), 0);
    return {
      scope: mine ? ('own' as const) : ('all' as const),
      totals: { minutes, billableMinutes },
      entries: await Promise.all(filtered.map((entry) => entryView(ctx, entry))),
    };
  },
});

/** Weeks waiting for a decision that the caller may decide. */
export const pendingApprovals = teamQuery('time.approve')({
  args: {},
  handler: async (ctx) => {
    const submitted = await ctx.db
      .query('timeEntries')
      .withIndex('by_status', (q) => q.eq('status', 'submitted'))
      .collect();
    const owner = isOwner(ctx.principal.role);
    const mine: Doc<'timeEntries'>[] = [];
    for (const entry of submitted) if (await canApprove(ctx, ctx.principal, entry, owner)) mine.push(entry);

    const weeks = new Map<
      string,
      { memberId: Id<'teamMembers'>; memberName: string; weekStart: string; minutes: number; entries: number }
    >();
    for (const entry of mine) {
      const key = `${entry.memberId}:${entry.weekStart}`;
      const row = weeks.get(key) ?? {
        memberId: entry.memberId,
        memberName: (await ctx.db.get('teamMembers', entry.memberId))?.name ?? 'Former member',
        weekStart: entry.weekStart,
        minutes: 0,
        entries: 0,
      };
      row.minutes += entry.minutes;
      row.entries += 1;
      weeks.set(key, row);
    }
    return [...weeks.values()].sort(
      (a, b) => a.weekStart.localeCompare(b.weekStart) || a.memberName.localeCompare(b.memberName),
    );
  },
});

/** One member's week, for an approver to look through before deciding. */
export const weekForReview = teamQuery('time.approve')({
  args: { memberId: v.id('teamMembers'), weekStart: v.string() },
  handler: async (ctx, { memberId, weekStart }) => {
    const entries = await ctx.db
      .query('timeEntries')
      .withIndex('by_member_week', (q) =>
        q.eq('memberId', memberId).eq('weekStart', weekStartOf(checkedDate(weekStart))),
      )
      .collect();
    const owner = isOwner(ctx.principal.role);
    const visible: Doc<'timeEntries'>[] = [];
    for (const entry of entries) {
      if (
        entry.status === 'submitted' ? await canApprove(ctx, ctx.principal, entry, owner) : ctx.can('time.view.all')
      ) {
        visible.push(entry);
      }
    }
    visible.sort((a, b) => a.date.localeCompare(b.date));
    return await Promise.all(visible.map((entry) => entryView(ctx, entry)));
  },
});

const entryFields = {
  projectId: v.id('projects'),
  taskId: v.optional(v.id('tasks')),
  date: v.string(),
  minutes: v.number(),
  description: v.string(),
  billable: v.boolean(),
};

async function checkedTask(ctx: Ctx, projectId: Id<'projects'>, taskId: Id<'tasks'> | undefined) {
  if (!taskId) return undefined;
  const task = await ctx.db.get('tasks', taskId);
  if (!task || task.projectId !== projectId) throw timeError('time.invalid', 'Choose a task on this project');
  return taskId;
}

/** Logs time for yourself. Entries start as drafts and keep your rates as they are now. */
export const log = teamMutation('time.log.own')({
  args: entryFields,
  handler: async (ctx, args) => {
    // Seeing the project is the same rule as logging on it: members, or anyone with projects.view.all.
    const project = await visibleProject(ctx, ctx.principal, args.projectId);
    if (project.status === 'archived' || project.status === 'cancelled') {
      throw projectError('projects.closed', `This project is ${project.status}`);
    }
    const date = checkedDate(args.date);
    const today = await studioToday(ctx);
    if (date > today) throw timeError('time.future', 'Time cannot be logged for a future date');
    return await ctx.db.insert('timeEntries', {
      memberId: ctx.principal.member._id,
      projectId: args.projectId,
      taskId: await checkedTask(ctx, args.projectId, args.taskId),
      date,
      weekStart: weekStartOf(date),
      minutes: checkedMinutes(args.minutes),
      description: text(args.description, 'Description', { required: true, max: 500 })!,
      billable: args.billable,
      status: 'draft',
      ...ratesFor(ctx.principal.member),
    });
  },
});

export const update = teamMutation('time.log.own')({
  args: { entryId: v.id('timeEntries'), ...entryFields },
  handler: async (ctx, { entryId, ...args }) => {
    const entry = await getEntry(ctx, entryId);
    if (!(await canEditEntry(ctx, ctx.principal, entry, isOwner(ctx.principal.role)))) {
      throw timeError(
        entry.status === 'invoiced' ? 'time.invoiced' : 'time.locked',
        entry.status === 'invoiced' ? 'Invoiced time cannot change' : 'This entry is no longer yours to change',
      );
    }
    await visibleProject(ctx, ctx.principal, args.projectId);
    const date = checkedDate(args.date);
    await ctx.db.patch('timeEntries', entryId, {
      projectId: args.projectId,
      taskId: await checkedTask(ctx, args.projectId, args.taskId),
      date,
      weekStart: weekStartOf(date),
      minutes: checkedMinutes(args.minutes),
      description: text(args.description, 'Description', { required: true, max: 500 })!,
      billable: args.billable,
      // An edited entry goes back to draft so the change is seen and approved again.
      status: entry.status === 'submitted' ? 'draft' : entry.status,
      returnedNote: undefined,
    });
  },
});

export const remove = teamMutation('time.log.own')({
  args: { entryId: v.id('timeEntries') },
  handler: async (ctx, { entryId }) => {
    const entry = await getEntry(ctx, entryId);
    if (entry.status === 'invoiced') throw timeError('time.invoiced', 'Invoiced time cannot be deleted');
    if (!(await canEditEntry(ctx, ctx.principal, entry, isOwner(ctx.principal.role)))) {
      throw timeError('time.locked', 'This entry is no longer yours to change');
    }
    await ctx.db.delete('timeEntries', entryId);
  },
});

/** Sends your drafts for the week to be approved. */
export const submitWeek = teamMutation('time.log.own')({
  args: { weekStart: v.string() },
  handler: async (ctx, { weekStart }) => {
    const week = weekStartOf(checkedDate(weekStart));
    const drafts = await ctx.db
      .query('timeEntries')
      .withIndex('by_member_week', (q) =>
        q.eq('memberId', ctx.principal.member._id).eq('weekStart', week).eq('status', 'draft'),
      )
      .collect();
    if (drafts.length === 0) throw timeError('time.nothingToSubmit', 'There are no draft entries in this week');
    const now = Date.now();
    for (const entry of drafts) {
      await ctx.db.patch('timeEntries', entry._id, { status: 'submitted', submittedAt: now, returnedNote: undefined });
    }
    return { submitted: drafts.length };
  },
});

async function decide(
  ctx: MutationCtx & Principal,
  entryIds: Id<'timeEntries'>[],
  decision: 'approve' | 'return',
  note?: string,
) {
  const owner = isOwner(ctx.principal.role);
  const reason = text(note, 'Note', { max: 500 });
  if (decision === 'return' && !reason) throw timeError('time.needsNote', 'Say what needs changing');
  let changed = 0;
  for (const entryId of entryIds) {
    const entry = await getEntry(ctx, entryId);
    if (entry.status !== 'submitted') continue;
    if (!(await canApprove(ctx, ctx.principal, entry, owner))) {
      throw timeError(
        entry.memberId === ctx.principal.member._id ? 'time.ownTime' : 'time.notYours',
        entry.memberId === ctx.principal.member._id
          ? 'Someone else approves your own time'
          : 'You approve time on the projects you manage',
      );
    }
    await ctx.db.patch('timeEntries', entryId, {
      status: decision === 'approve' ? 'approved' : 'draft',
      approvedBy: decision === 'approve' ? ctx.principal.member._id : undefined,
      approvedAt: decision === 'approve' ? Date.now() : undefined,
      returnedNote: decision === 'return' ? reason : undefined,
    });
    changed++;
  }
  return { changed };
}

export const approve = teamMutation('time.approve')({
  args: { entryIds: v.array(v.id('timeEntries')) },
  handler: async (ctx, { entryIds }) => await decide(ctx, entryIds, 'approve'),
});

/** Sends entries back as drafts with a note saying what to change. */
export const returnEntries = teamMutation('time.approve')({
  args: { entryIds: v.array(v.id('timeEntries')), note: v.string() },
  handler: async (ctx, { entryIds, note }) => await decide(ctx, entryIds, 'return', note),
});

/**
 * Fills in the rates on an entry logged before Finance set the member's rates. Needs team.rates.sensitive; invoiced
 * entries never change, and the audit log keeps the change with the amounts redacted.
 */
export const setEntryRates = teamMutation('team.rates.sensitive')({
  args: {
    entryId: v.id('timeEntries'),
    costRateMinor: v.optional(v.number()),
    billRateMinor: v.optional(v.number()),
    currency: v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR')),
  },
  handler: async (ctx, { entryId, costRateMinor, billRateMinor, currency }) => {
    const entry = await getEntry(ctx, entryId);
    if (entry.status === 'invoiced') throw timeError('time.invoiced', 'Invoiced time cannot change');
    for (const [label, value] of [
      ['Cost rate', costRateMinor],
      ['Bill rate', billRateMinor],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw timeError('time.invalid', `${label} must be a whole, non-negative amount in minor units`);
      }
    }
    await ctx.db.patch('timeEntries', entryId, { costRateMinor, billRateMinor, rateCurrency: currency });
  },
});

// Timer ------------------------------------------------------------------------------------------------------------------

/** The timer running in the app header, if any. */
export const runningTimer = teamQuery('time.log.own')({
  args: {},
  handler: async (ctx) => {
    const timer = await ctx.db
      .query('timers')
      .withIndex('by_member', (q) => q.eq('memberId', ctx.principal.member._id))
      .unique();
    if (!timer) return null;
    const project = await ctx.db.get('projects', timer.projectId);
    const task = timer.taskId ? await ctx.db.get('tasks', timer.taskId) : null;
    return {
      projectId: timer.projectId,
      projectName: project?.name ?? 'Project',
      taskId: timer.taskId,
      taskTitle: task?.title,
      description: timer.description,
      startedAt: timer.startedAt,
    };
  },
});

export const startTimer = teamMutation('time.log.own')({
  args: { projectId: v.id('projects'), taskId: v.optional(v.id('tasks')), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await visibleProject(ctx, ctx.principal, args.projectId);
    const running = await ctx.db
      .query('timers')
      .withIndex('by_member', (q) => q.eq('memberId', ctx.principal.member._id))
      .unique();
    if (running) throw timeError('time.timerRunning', 'Stop the timer that is already running first');
    await ctx.db.insert('timers', {
      memberId: ctx.principal.member._id,
      projectId: args.projectId,
      taskId: await checkedTask(ctx, args.projectId, args.taskId),
      description: text(args.description, 'Description', { max: 500 }) ?? '',
      startedAt: Date.now(),
    });
  },
});

/** Stops the timer and writes a draft entry, rounded up to the minute. A timer left running is capped at 12 hours. */
export const stopTimer = teamMutation('time.log.own')({
  args: { description: v.optional(v.string()), billable: v.optional(v.boolean()) },
  handler: async (ctx, { description, billable }) => {
    const timer = await ctx.db
      .query('timers')
      .withIndex('by_member', (q) => q.eq('memberId', ctx.principal.member._id))
      .unique();
    if (!timer) throw timeError('time.noTimer', 'No timer is running');
    await ctx.db.delete('timers', timer._id);

    const minutes = Math.min(Math.max(1, Math.ceil((Date.now() - timer.startedAt) / 60_000)), MAX_TIMER_MINUTES);
    const date = await studioToday(ctx);
    return await ctx.db.insert('timeEntries', {
      memberId: ctx.principal.member._id,
      projectId: timer.projectId,
      taskId: timer.taskId,
      date,
      weekStart: weekStartOf(date),
      minutes,
      description: (text(description, 'Description', { max: 500 }) ?? timer.description) || 'Timed work',
      billable: billable ?? true,
      status: 'draft',
      ...ratesFor(ctx.principal.member),
    });
  },
});

export const cancelTimer = teamMutation('time.log.own')({
  args: {},
  handler: async (ctx) => {
    const timer = await ctx.db
      .query('timers')
      .withIndex('by_member', (q) => q.eq('memberId', ctx.principal.member._id))
      .unique();
    if (timer) await ctx.db.delete('timers', timer._id);
  },
});

/** Hours logged on a project, for its overview: total, billable, and how they sit against the task estimates. */
export const projectSummary = teamQuery(null)({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await visibleProject(ctx, ctx.principal, projectId);
    const [entries, tasks] = await Promise.all([
      ctx.db
        .query('timeEntries')
        .withIndex('by_project_date', (q) => q.eq('projectId', projectId))
        .collect(),
      ctx.db
        .query('tasks')
        .withIndex('by_project_status', (q) => q.eq('projectId', projectId))
        .collect(),
    ]);
    const visible = ctx.can('time.view.all') ? entries : entries.filter((e) => e.memberId === ctx.principal.member._id);
    return {
      scope: ctx.can('time.view.all') ? ('all' as const) : ('own' as const),
      loggedMinutes: visible.reduce((sum, entry) => sum + entry.minutes, 0),
      billableMinutes: visible.reduce((sum, entry) => sum + (entry.billable ? entry.minutes : 0), 0),
      approvedMinutes: visible
        .filter((entry) => LOCKED_STATUSES.has(entry.status))
        .reduce((sum, entry) => sum + entry.minutes, 0),
      estimateMinutes: tasks.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0),
      missingRates: ctx.can('team.rates.sensitive')
        ? visible.filter((entry) => entry.billRateMinor === undefined).length
        : undefined,
    };
  },
});

/** Everyone's unsubmitted weeks, so the Owner and Admins can nudge. */
export const outstandingWeeks = teamQuery('time.view.all')({
  args: {},
  handler: async (ctx) => {
    const drafts = await ctx.db
      .query('timeEntries')
      .withIndex('by_status', (q) => q.eq('status', 'draft'))
      .collect();
    const thisWeek = weekStartOf(await studioToday(ctx));
    const weeks = new Map<
      string,
      { memberId: Id<'teamMembers'>; memberName: string; weekStart: string; minutes: number }
    >();
    for (const entry of drafts.filter((entry) => entry.weekStart < thisWeek)) {
      const key = `${entry.memberId}:${entry.weekStart}`;
      const row = weeks.get(key) ?? {
        memberId: entry.memberId,
        memberName: (await ctx.db.get('teamMembers', entry.memberId))?.name ?? 'Former member',
        weekStart: entry.weekStart,
        minutes: 0,
      };
      row.minutes += entry.minutes;
      weeks.set(key, row);
    }
    return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  },
});

/** The projects you can log time on, for the timer and the log form. */
export const myRecentProjects = teamQuery('time.log.own')({
  args: {},
  handler: async (ctx) => {
    const visible = await visibleProjectIds(ctx, ctx.principal);
    const projects = await ctx.db.query('projects').take(1000);
    return projects
      .filter(
        (project) =>
          (visible === 'all' || visible.has(project._id)) &&
          project.status !== 'archived' &&
          project.status !== 'cancelled',
      )
      .map((project) => ({ id: project._id, code: project.code, name: project.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
