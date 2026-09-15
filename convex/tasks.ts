import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { requirePermission, text } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { type TeamPrincipal } from './lib/principals';
import {
  assertOpen,
  assertProjectMembers,
  notFound,
  projectError,
  visibleProject,
  visibleProjectIds,
} from './lib/projects';
import { isIsoDate } from './lib/validation';

// Tasks (06-projects.md, Tasks). tasks.manage.all manages tasks on any visible project; tasks.manage.assigned within
// project scope. Assignees must be project members. `taskAssignments` mirrors assignees so "my tasks" is indexable.

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };

const taskStatus = v.union(v.literal('todo'), v.literal('in_progress'), v.literal('blocked'), v.literal('done'));
const priority = v.union(v.literal('low'), v.literal('medium'), v.literal('high'), v.literal('urgent'));

function assertCanManage(principal: TeamPrincipal) {
  if (!principal.permissions.has('tasks.manage.all')) requirePermission(principal, 'tasks.manage.assigned');
}

async function manageableTask(ctx: MutationCtx & Principal, taskId: Id<'tasks'>) {
  const task = await ctx.db.get('tasks', taskId);
  if (!task) throw notFound('Task');
  const project = await visibleProject(ctx, ctx.principal, task.projectId);
  assertCanManage(ctx.principal);
  return { task, project };
}

function checkedDate(value: string | undefined) {
  if (!value) return undefined;
  if (!isIsoDate(value)) throw projectError('projects.invalid', 'Choose a due date');
  return value;
}

function checkedEstimate(minutes: number | undefined) {
  if (minutes === undefined) return undefined;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1000 * 60) {
    throw projectError('projects.invalid', 'The estimate must be a whole number of minutes, up to 1,000 hours');
  }
  return minutes;
}

async function checkedMilestone(ctx: Ctx, projectId: Id<'projects'>, milestoneId: Id<'milestones'> | undefined) {
  if (!milestoneId) return undefined;
  const milestone = await ctx.db.get('milestones', milestoneId);
  if (!milestone || milestone.projectId !== projectId)
    throw projectError('projects.invalid', 'Choose a milestone of this project');
  return milestoneId;
}

/** Keeps `taskAssignments` in step with the task's assignees, status and due date. */
async function syncAssignments(ctx: MutationCtx, task: Doc<'tasks'>) {
  const rows = await ctx.db
    .query('taskAssignments')
    .withIndex('by_task', (q) => q.eq('taskId', task._id))
    .collect();
  for (const row of rows) {
    if (!task.assigneeMemberIds.includes(row.memberId)) await ctx.db.delete('taskAssignments', row._id);
    else if (row.status !== task.status || row.dueDate !== task.dueDate) {
      await ctx.db.patch('taskAssignments', row._id, { status: task.status, dueDate: task.dueDate });
    }
  }
  for (const memberId of task.assigneeMemberIds) {
    if (!rows.some((row) => row.memberId === memberId)) {
      await ctx.db.insert('taskAssignments', {
        taskId: task._id,
        memberId,
        status: task.status,
        dueDate: task.dueDate,
      });
    }
  }
}

async function taskView(ctx: Ctx, task: Doc<'tasks'>) {
  const assignees = await Promise.all(task.assigneeMemberIds.map((id) => ctx.db.get('teamMembers', id)));
  const milestone = task.milestoneId ? await ctx.db.get('milestones', task.milestoneId) : null;
  return {
    id: task._id,
    projectId: task.projectId,
    milestone: milestone ? { id: milestone._id, name: milestone.name } : null,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignees: assignees
      .filter((member): member is Doc<'teamMembers'> => member !== null)
      .map((member) => ({ id: member._id, name: member.name })),
    dueDate: task.dueDate,
    estimateMinutes: task.estimateMinutes,
    order: task.order,
    completedAt: task.completedAt,
  };
}

export const listForProject = teamQuery(null)({
  args: {
    projectId: v.id('projects'),
    assigneeMemberId: v.optional(v.id('teamMembers')),
    milestoneId: v.optional(v.id('milestones')),
    priority: v.optional(priority),
  },
  handler: async (ctx, { projectId, assigneeMemberId, milestoneId, priority: wanted }) => {
    await visibleProject(ctx, ctx.principal, projectId);
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId))
      .collect();
    const filtered = tasks.filter(
      (task) =>
        (!assigneeMemberId || task.assigneeMemberIds.includes(assigneeMemberId)) &&
        (!milestoneId || task.milestoneId === milestoneId) &&
        (!wanted || task.priority === wanted),
    );
    return await Promise.all(filtered.map((task) => taskView(ctx, task)));
  },
});

/** Your open tasks across projects you can still see, overdue first. */
export const mine = teamQuery(null)({
  args: {},
  handler: async (ctx) => {
    const visible = await visibleProjectIds(ctx, ctx.principal);
    const rows = await ctx.db
      .query('taskAssignments')
      .withIndex('by_member_status', (q) => q.eq('memberId', ctx.principal.member._id))
      .collect();
    const open = rows.filter((row) => row.status !== 'done');
    const tasks = (await Promise.all(open.map((row) => ctx.db.get('tasks', row.taskId)))).filter(
      (task): task is Doc<'tasks'> => task !== null && (visible === 'all' || visible.has(task.projectId)),
    );
    const views = await Promise.all(
      tasks.map(async (task) => {
        const project = await ctx.db.get('projects', task.projectId);
        return { ...(await taskView(ctx, task)), projectCode: project?.code, projectName: project?.name };
      }),
    );
    return views.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  },
});

const fields = {
  title: v.string(),
  description: v.optional(v.string()),
  milestoneId: v.optional(v.id('milestones')),
  priority,
  assigneeMemberIds: v.array(v.id('teamMembers')),
  dueDate: v.optional(v.string()),
  estimateMinutes: v.optional(v.number()),
};

export const create = teamMutation(null)({
  args: { projectId: v.id('projects'), status: v.optional(taskStatus), ...fields },
  handler: async (ctx, { projectId, status = 'todo', ...args }) => {
    const project = await visibleProject(ctx, ctx.principal, projectId);
    assertCanManage(ctx.principal);
    assertOpen(project);
    const assignees = [...new Set(args.assigneeMemberIds)];
    await assertProjectMembers(ctx, projectId, assignees);
    const column = await ctx.db
      .query('tasks')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
      .collect();
    const taskId = await ctx.db.insert('tasks', {
      projectId,
      milestoneId: await checkedMilestone(ctx, projectId, args.milestoneId),
      title: text(args.title, 'Title', { required: true, max: 200 })!,
      description: text(args.description, 'Description', { max: 10_000 }),
      status,
      priority: args.priority,
      assigneeMemberIds: assignees,
      dueDate: checkedDate(args.dueDate),
      estimateMinutes: checkedEstimate(args.estimateMinutes),
      order: column.length,
      completedAt: status === 'done' ? Date.now() : undefined,
    });
    await syncAssignments(ctx, (await ctx.db.get('tasks', taskId))!);
    return taskId;
  },
});

export const update = teamMutation(null)({
  args: { taskId: v.id('tasks'), ...fields },
  handler: async (ctx, { taskId, ...args }) => {
    const { task, project } = await manageableTask(ctx, taskId);
    assertOpen(project);
    const assignees = [...new Set(args.assigneeMemberIds)];
    await assertProjectMembers(ctx, project._id, assignees);
    await ctx.db.patch('tasks', taskId, {
      milestoneId: await checkedMilestone(ctx, project._id, args.milestoneId),
      title: text(args.title, 'Title', { required: true, max: 200 })!,
      description: text(args.description, 'Description', { max: 10_000 }),
      priority: args.priority,
      assigneeMemberIds: assignees,
      dueDate: checkedDate(args.dueDate),
      estimateMinutes: checkedEstimate(args.estimateMinutes),
    });
    await syncAssignments(ctx, (await ctx.db.get('tasks', task._id))!);
  },
});

/** Moves a task to a status column and position (for the board). */
export const move = teamMutation(null)({
  args: { taskId: v.id('tasks'), status: taskStatus, index: v.optional(v.number()) },
  handler: async (ctx, { taskId, status, index }) => {
    const { task, project } = await manageableTask(ctx, taskId);
    assertOpen(project);
    const column = (
      await ctx.db
        .query('tasks')
        .withIndex('by_project_status', (q) => q.eq('projectId', project._id).eq('status', status))
        .collect()
    ).filter((other) => other._id !== taskId);
    const position = Math.max(0, Math.min(index ?? column.length, column.length));
    column.splice(position, 0, task);
    for (const [order, row] of column.entries()) {
      if (row._id === taskId) {
        await ctx.db.patch('tasks', taskId, {
          status,
          order,
          completedAt: status === 'done' ? (task.status === 'done' ? task.completedAt : Date.now()) : undefined,
        });
      } else if (row.order !== order) {
        await ctx.db.patch('tasks', row._id, { order });
      }
    }
    await syncAssignments(ctx, (await ctx.db.get('tasks', taskId))!);
  },
});

export const remove = teamMutation(null)({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const { project } = await manageableTask(ctx, taskId);
    assertOpen(project);
    for (const row of await ctx.db
      .query('taskAssignments')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .collect()) {
      await ctx.db.delete('taskAssignments', row._id);
    }
    for (const comment of await ctx.db
      .query('comments')
      .withIndex('by_target', (q) => q.eq('target.table', 'tasks').eq('target.id', taskId))
      .collect()) {
      await ctx.db.delete('comments', comment._id);
    }
    await ctx.db.delete('tasks', taskId);
  },
});
