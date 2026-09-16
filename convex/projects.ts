import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { assertActiveMember, getClient, recordActivity, requirePermission, text, website } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { orderedStages } from './lib/deals';
import { nextNumber } from './lib/numbering';
import { type TeamPrincipal } from './lib/principals';
import {
  addDaysToDate,
  assertOpen,
  CLOSED_STATUSES,
  membership,
  notFound,
  projectError,
  visibleProject,
  visibleProjectIds,
} from './lib/projects';
import { isIsoDate } from './lib/validation';

// Projects (06-projects.md). A project belongs to one client, has a manager who is always a member, and is created
// blank, from a template, or when a deal is won. Budget used arrives with billing (expenses, bills, FX rates).

type Ctx = QueryCtx | MutationCtx;
type Principal = { principal: TeamPrincipal };
type Status = Doc<'projects'>['status'];

const currency = v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'));
const projectType = v.union(
  v.literal('mobile_app'),
  v.literal('web_platform'),
  v.literal('product_design'),
  v.literal('backend'),
  v.literal('devops'),
  v.literal('video'),
  v.literal('dev_tool'),
  v.literal('retainer'),
  v.literal('other'),
);
const billingModel = v.union(v.literal('fixed'), v.literal('time_and_materials'), v.literal('retainer'));
const status = v.union(
  v.literal('planning'),
  v.literal('active'),
  v.literal('on_hold'),
  v.literal('completed'),
  v.literal('cancelled'),
  v.literal('archived'),
);

const STATUS_LABELS: Record<Status, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

/** Which status changes are allowed. Archiving needs projects.archive; the rest need projects.update. */
const TRANSITIONS: Record<Status, Status[]> = {
  planning: ['active', 'on_hold', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: ['active', 'archived'],
  cancelled: ['planning', 'archived'],
  archived: ['completed'],
};

function checkedDate(value: string | undefined, label: string, required = false) {
  if (!value) {
    if (required) throw projectError('projects.invalid', `${label} is required`);
    return undefined;
  }
  if (!isIsoDate(value)) throw projectError('projects.invalid', `${label} must be a date`);
  return value;
}

function checkedBudget(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw projectError('projects.invalid', 'The budget must be a whole, non-negative amount in minor units');
  }
  return value;
}

function checkedLinks(links: { repo?: string; staging?: string; production?: string; design?: string }) {
  return {
    repo: website(links.repo),
    staging: website(links.staging),
    production: website(links.production),
    design: website(links.design),
  };
}

async function addMember(ctx: MutationCtx, projectId: Id<'projects'>, memberId: Id<'teamMembers'>, role?: string) {
  if (await membership(ctx, projectId, memberId)) return;
  await ctx.db.insert('projectMembers', { projectId, memberId, projectRole: role, joinedAt: Date.now() });
}

const CLIENT_STATUS_LABELS: Record<Doc<'clients'>['status'], string> = {
  lead: 'Lead',
  active: 'Active',
  past: 'Past',
  archived: 'Archived',
};

/**
 * The client moves from lead to active when its first project starts, and to past when its last open project finishes
 * (05-crm.md, Clients). Retainers join this rule with billing automation. Archived clients are left alone.
 */
async function syncClientStatus(ctx: MutationCtx & Principal, clientId: Id<'clients'>) {
  const client = await getClient(ctx, clientId);
  if (client.status === 'archived') return;
  const projects = await ctx.db
    .query('projects')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  const anyActive = projects.some((project) => project.status === 'active');
  const anyOpen = projects.some((project) => !CLOSED_STATUSES.has(project.status));
  const anyCompleted = projects.some((project) => project.status === 'completed' || project.status === 'archived');
  const next = anyActive ? 'active' : client.status === 'active' && !anyOpen && anyCompleted ? 'past' : client.status;
  if (next === client.status) return;
  await ctx.db.patch('clients', clientId, { status: next });
  await recordActivity(ctx, {
    subject: { table: 'clients', id: clientId },
    clientId,
    type: 'status_change',
    title: `Status changed from ${CLIENT_STATUS_LABELS[client.status]} to ${CLIENT_STATUS_LABELS[next]}`,
    body: next === 'active' ? 'A project started' : 'The last open project finished',
    actor: { kind: 'system' },
    meta: { from: client.status, to: next, manual: false },
  });
}

async function projectSummary(ctx: Ctx, project: Doc<'projects'>) {
  const [client, manager, milestones] = await Promise.all([
    ctx.db.get('clients', project.clientId),
    ctx.db.get('teamMembers', project.managerMemberId),
    ctx.db
      .query('milestones')
      .withIndex('by_project_order', (q) => q.eq('projectId', project._id))
      .collect(),
  ]);
  const done = milestones.filter((m) => m.status === 'approved' || m.status === 'invoiced' || m.status === 'skipped');
  return {
    id: project._id,
    code: project.code,
    name: project.name,
    clientId: project.clientId,
    clientName: client?.displayName ?? 'Unknown client',
    type: project.type,
    status: project.status,
    billingModel: project.billingModel,
    currency: project.currency,
    startDate: project.startDate,
    dueDate: project.dueDate,
    managerMemberId: project.managerMemberId,
    managerName: manager?.name ?? 'Former member',
    milestoneProgress: { done: done.length, total: milestones.length },
    nextMilestone: milestones.find((m) => !done.includes(m))?.name,
  };
}

export const list = teamQuery(null)({
  args: {
    status: v.optional(v.union(status, v.literal('open'))),
    clientId: v.optional(v.id('clients')),
    managerMemberId: v.optional(v.id('teamMembers')),
  },
  handler: async (ctx, { status: wanted = 'open', clientId, managerMemberId }) => {
    const visible = await visibleProjectIds(ctx, ctx.principal);
    if (visible !== 'all' && visible.size === 0) {
      if (!ctx.can('projects.view.assigned')) requirePermission(ctx.principal, 'projects.view.all');
      return [];
    }
    const projects = clientId
      ? await ctx.db
          .query('projects')
          .withIndex('by_client', (q) => q.eq('clientId', clientId))
          .collect()
      : await ctx.db.query('projects').take(1000);
    const filtered = projects.filter(
      (project) =>
        (visible === 'all' || visible.has(project._id)) &&
        (wanted === 'open' ? !CLOSED_STATUSES.has(project.status) : project.status === wanted) &&
        (!managerMemberId || project.managerMemberId === managerMemberId),
    );
    const views = await Promise.all(filtered.map((project) => projectSummary(ctx, project)));
    return views.sort((a, b) => b.code.localeCompare(a.code));
  },
});

export const get = teamQuery(null)({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await visibleProject(ctx, ctx.principal, projectId);
    const members = await ctx.db
      .query('projectMembers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId))
      .collect();
    const deal = project.dealId ? await ctx.db.get('deals', project.dealId) : null;
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...(await projectSummary(ctx, project)),
      budgetMinor: project.budgetMinor,
      dealId: project.dealId,
      dealTitle: deal?.title,
      slaPolicyId: project.slaPolicyId,
      links: project.links,
      description: project.description,
      completedAt: project.completedAt,
      handoverStatus: project.handoverStatus,
      members: await Promise.all(
        members.map(async (row) => {
          const member = await ctx.db.get('teamMembers', row.memberId);
          return {
            memberId: row.memberId,
            name: member?.name ?? 'Former member',
            title: member?.title,
            projectRole: row.projectRole,
            isManager: row.memberId === project.managerMemberId,
            status: member?.status ?? 'offboarded',
          };
        }),
      ),
      isMember: members.some((row) => row.memberId === ctx.principal.member._id),
      tasks: {
        open: tasks.filter((task) => task.status !== 'done').length,
        overdue: tasks.filter((task) => task.status !== 'done' && task.dueDate !== undefined && task.dueDate < today)
          .length,
        estimateMinutes: tasks.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0),
      },
    };
  },
});

const editable = {
  name: v.string(),
  type: projectType,
  billingModel,
  currency,
  budgetMinor: v.optional(v.number()),
  startDate: v.string(),
  dueDate: v.optional(v.string()),
  managerMemberId: v.optional(v.id('teamMembers')),
  description: v.optional(v.string()),
};

/**
 * Creates a project in planning, with the next project code. From a template it adds the milestones (dated from the
 * start), their deliverables and the tasks. From a deal it also marks the deal won. The manager becomes a member.
 */
export async function createProject(
  ctx: MutationCtx & Principal,
  args: {
    clientId: Id<'clients'>;
    templateId?: Id<'projectTemplates'>;
    dealId?: Id<'deals'>;
    name: string;
    type: Doc<'projects'>['type'];
    billingModel: Doc<'projects'>['billingModel'];
    currency: Doc<'projects'>['currency'];
    budgetMinor?: number;
    startDate: string;
    dueDate?: string;
    managerMemberId?: Id<'teamMembers'>;
    description?: string;
  },
): Promise<Id<'projects'>> {
  requirePermission(ctx.principal, 'projects.create');
  const client = await getClient(ctx, args.clientId);
  if (client.status === 'archived') throw projectError('projects.invalid', 'Restore the client from the archive first');
  const managerMemberId = args.managerMemberId ?? ctx.principal.member._id;
  await assertActiveMember(ctx, managerMemberId);
  const startDate = checkedDate(args.startDate, 'Start date', true)!;
  const template = args.templateId ? await ctx.db.get('projectTemplates', args.templateId) : null;
  if (args.templateId && (!template || !template.active))
    throw projectError('projects.invalid', 'Choose an active template');

  const lastOffset = template?.milestones.reduce((max, m) => Math.max(max, m.offsetDays), 0);
  const dueDate =
    checkedDate(args.dueDate, 'Due date') ?? (lastOffset ? addDaysToDate(startDate, lastOffset) : undefined);
  if (dueDate && dueDate < startDate)
    throw projectError('projects.invalid', 'The due date must be after the start date');

  const projectId = await ctx.db.insert('projects', {
    code: await nextNumber(ctx, 'project'),
    name: text(args.name, 'Name', { required: true, max: 120 })!,
    clientId: args.clientId,
    dealId: args.dealId,
    templateId: template?._id,
    type: args.type,
    status: 'planning',
    billingModel: args.billingModel,
    budgetMinor: checkedBudget(args.budgetMinor),
    currency: args.currency,
    startDate,
    dueDate,
    managerMemberId,
    links: {},
    description: text(args.description, 'Description', { max: 5000 }),
    handoverStatus: 'not_started',
  });
  await addMember(ctx, projectId, managerMemberId, 'Project manager');

  if (template) {
    const milestoneIds: Id<'milestones'>[] = [];
    for (const [order, milestone] of template.milestones.entries()) {
      const milestoneId = await ctx.db.insert('milestones', {
        projectId,
        name: milestone.name,
        order,
        dueDate: addDaysToDate(startDate, milestone.offsetDays),
        status: 'upcoming',
        billingPercentBps: milestone.billingPercentBps,
      });
      milestoneIds.push(milestoneId);
      for (const title of milestone.deliverables) {
        await ctx.db.insert('deliverables', { projectId, milestoneId, title, status: 'draft', currentVersion: 0 });
      }
    }
    for (const [order, task] of template.tasks.entries()) {
      await ctx.db.insert('tasks', {
        projectId,
        milestoneId: task.milestoneIndex === undefined ? undefined : milestoneIds[task.milestoneIndex],
        title: task.title,
        status: 'todo',
        priority: 'medium',
        assigneeMemberIds: [],
        estimateMinutes: task.estimateMinutes,
        order,
      });
    }
  }

  const project = (await ctx.db.get('projects', projectId))!;
  await recordActivity(ctx, {
    subject: { table: 'projects', id: projectId },
    clientId: args.clientId,
    type: 'system',
    title: `Project ${project.code} created${template ? ` from the ${template.name} template` : ''}`,
    body: project.name,
    actor: { kind: 'team', id: ctx.principal.member._id },
  });
  return projectId;
}

export const create = teamMutation('projects.create')({
  args: { clientId: v.id('clients'), templateId: v.optional(v.id('projectTemplates')), ...editable },
  handler: async (ctx, args) => await createProject(ctx, args),
});

export const update = teamMutation('projects.update')({
  args: {
    projectId: v.id('projects'),
    ...editable,
    slaPolicyId: v.optional(v.id('slaPolicies')),
    links: v.object({
      repo: v.optional(v.string()),
      staging: v.optional(v.string()),
      production: v.optional(v.string()),
      design: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { projectId, ...args }) => {
    const project = await visibleProject(ctx, ctx.principal, projectId);
    assertOpen(project);
    const managerMemberId = args.managerMemberId ?? project.managerMemberId;
    await assertActiveMember(ctx, managerMemberId);
    const startDate = checkedDate(args.startDate, 'Start date', true)!;
    const dueDate = checkedDate(args.dueDate, 'Due date');
    if (dueDate && dueDate < startDate)
      throw projectError('projects.invalid', 'The due date must be after the start date');
    if (args.slaPolicyId && !(await ctx.db.get('slaPolicies', args.slaPolicyId))?.active) {
      throw projectError('projects.invalid', 'Choose an active SLA policy');
    }
    await ctx.db.patch('projects', projectId, {
      name: text(args.name, 'Name', { required: true, max: 120 })!,
      type: args.type,
      billingModel: args.billingModel,
      currency: args.currency,
      budgetMinor: checkedBudget(args.budgetMinor),
      startDate,
      dueDate,
      managerMemberId,
      description: text(args.description, 'Description', { max: 5000 }),
      slaPolicyId: args.slaPolicyId,
      links: checkedLinks(args.links),
    });
    if (managerMemberId !== project.managerMemberId)
      await addMember(ctx, projectId, managerMemberId, 'Project manager');
  },
});

/**
 * Changes the project's status and records it. Completing needs every milestone approved, invoiced or skipped.
 * Archiving needs projects.archive. Starting or finishing projects moves the client's status (see syncClientStatus).
 */
export const setStatus = teamMutation('projects.update')({
  args: { projectId: v.id('projects'), status, reason: v.optional(v.string()) },
  handler: async (ctx, { projectId, status: next, reason }) => {
    const project = await visibleProject(ctx, ctx.principal, projectId);
    if (project.status === next) return;
    if (!TRANSITIONS[project.status].includes(next)) {
      throw projectError(
        'projects.invalidStatus',
        `A ${STATUS_LABELS[project.status].toLowerCase()} project cannot become ${STATUS_LABELS[next].toLowerCase()}`,
      );
    }
    if ((next === 'archived' || project.status === 'archived') && !ctx.can('projects.archive')) {
      requirePermission(ctx.principal, 'projects.archive');
    }
    if (next === 'completed') {
      const milestones = await ctx.db
        .query('milestones')
        .withIndex('by_project_order', (q) => q.eq('projectId', projectId))
        .collect();
      const pending = milestones.filter((m) => !['approved', 'invoiced', 'skipped'].includes(m.status));
      if (pending.length > 0) {
        throw projectError(
          'projects.milestonesPending',
          `Approve or skip every milestone first: ${pending.map((m) => m.name).join(', ')}`,
        );
      }
    }
    await ctx.db.patch('projects', projectId, {
      status: next,
      completedAt: next === 'completed' ? Date.now() : next === 'archived' ? project.completedAt : undefined,
    });
    await recordActivity(ctx, {
      subject: { table: 'projects', id: projectId },
      clientId: project.clientId,
      type: 'status_change',
      title: `${project.code} changed from ${STATUS_LABELS[project.status]} to ${STATUS_LABELS[next]}`,
      body: text(reason, 'Reason', { max: 500 }),
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { from: project.status, to: next },
    });
    await syncClientStatus(ctx, project.clientId);
  },
});

// Members ---------------------------------------------------------------------------------------------------------------

export const addProjectMember = teamMutation('projects.members.manage')({
  args: { projectId: v.id('projects'), memberId: v.id('teamMembers'), projectRole: v.optional(v.string()) },
  handler: async (ctx, { projectId, memberId, projectRole }) => {
    const project = await visibleProject(ctx, ctx.principal, projectId);
    assertOpen(project);
    await assertActiveMember(ctx, memberId);
    if (await membership(ctx, projectId, memberId))
      throw projectError('projects.alreadyMember', 'Already on the project');
    await addMember(ctx, projectId, memberId, text(projectRole, 'Project role', { max: 60 }));
  },
});

export const setMemberRole = teamMutation('projects.members.manage')({
  args: { projectId: v.id('projects'), memberId: v.id('teamMembers'), projectRole: v.optional(v.string()) },
  handler: async (ctx, { projectId, memberId, projectRole }) => {
    await visibleProject(ctx, ctx.principal, projectId);
    const row = await membership(ctx, projectId, memberId);
    if (!row) throw notFound('Project member');
    await ctx.db.patch('projectMembers', row._id, { projectRole: text(projectRole, 'Project role', { max: 60 }) });
  },
});

/** Removes someone from a project: they lose sight of it at once and come off its tasks. The manager stays. */
export async function removeFromProject(ctx: MutationCtx, projectId: Id<'projects'>, memberId: Id<'teamMembers'>) {
  const row = await membership(ctx, projectId, memberId);
  if (!row) return false;
  await ctx.db.delete('projectMembers', row._id);
  const tasks = await ctx.db
    .query('tasks')
    .withIndex('by_project_status', (q) => q.eq('projectId', projectId))
    .collect();
  for (const task of tasks.filter((t) => t.assigneeMemberIds.includes(memberId))) {
    await ctx.db.patch('tasks', task._id, {
      assigneeMemberIds: task.assigneeMemberIds.filter((id) => id !== memberId),
    });
    const assignment = (
      await ctx.db
        .query('taskAssignments')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .collect()
    ).find((a) => a.memberId === memberId);
    if (assignment) await ctx.db.delete('taskAssignments', assignment._id);
  }
  return true;
}

export const removeProjectMember = teamMutation('projects.members.manage')({
  args: { projectId: v.id('projects'), memberId: v.id('teamMembers') },
  handler: async (ctx, { projectId, memberId }) => {
    const project = await visibleProject(ctx, ctx.principal, projectId);
    if (memberId === project.managerMemberId) {
      throw projectError('projects.manager', 'Choose another manager before removing this one');
    }
    if (!(await removeFromProject(ctx, projectId, memberId))) throw notFound('Project member');
  },
});

// Won deals ---------------------------------------------------------------------------------------------------------------

async function markDealWon(ctx: MutationCtx & Principal, deal: Doc<'deals'>, project: Doc<'projects'>) {
  const stages = await orderedStages(ctx);
  const won = stages.find((stage) => stage.kind === 'won');
  const from = stages.find((stage) => stage._id === deal.stageId);
  if (!won) throw projectError('projects.invalid', 'The pipeline has no Won stage');
  if (from?.kind !== 'open') throw projectError('projects.invalid', 'Only open deals can be won');
  const now = Date.now();
  await ctx.db.patch('deals', deal._id, { stageId: won._id, wonAt: now, probabilityBps: 10_000 });
  await recordActivity(ctx, {
    subject: { table: 'deals', id: deal._id },
    clientId: deal.clientId,
    type: 'status_change',
    title: `Moved from ${from.name} to ${won.name}`,
    body: `Project ${project.code}: ${project.name}`,
    actor: { kind: 'team', id: ctx.principal.member._id },
    meta: { fromStageId: from._id, toStageId: won._id, projectId: project._id },
    occurredAt: now,
  });
}

async function openDeal(ctx: MutationCtx & Principal, dealId: Id<'deals'>) {
  requirePermission(ctx.principal, 'deals.manage');
  const deal = await ctx.db.get('deals', dealId);
  if (!deal) throw projectError('projects.invalid', 'Deal not found');
  return deal;
}

/** Wins a deal by creating its project, optionally from a template, for the deal's client. */
export const winDealWithNewProject = teamMutation('projects.create')({
  args: { dealId: v.id('deals'), templateId: v.optional(v.id('projectTemplates')), ...editable },
  handler: async (ctx, { dealId, ...args }) => {
    const deal = await openDeal(ctx, dealId);
    const projectId = await createProject(ctx, { ...args, clientId: deal.clientId, dealId });
    await markDealWon(ctx, deal, (await ctx.db.get('projects', projectId))!);
    return projectId;
  },
});

/** Wins a deal by linking an existing project of the same client that no other deal has won. */
export const winDealWithExistingProject = teamMutation('deals.manage')({
  args: { dealId: v.id('deals'), projectId: v.id('projects') },
  handler: async (ctx, { dealId, projectId }) => {
    const deal = await openDeal(ctx, dealId);
    const project = await visibleProject(ctx, ctx.principal, projectId);
    if (project.clientId !== deal.clientId)
      throw projectError('projects.invalid', 'Choose a project for the same client');
    if (project.dealId && project.dealId !== dealId) {
      throw projectError('projects.invalid', 'That project already belongs to another won deal');
    }
    await ctx.db.patch('projects', projectId, { dealId });
    await markDealWon(ctx, deal, project);
    return projectId;
  },
});

/** The project a won deal became, for its page. */
export const forDeal = teamQuery('deals.view')({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const project = await ctx.db
      .query('projects')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .first();
    if (!project) return null;
    const visible = await visibleProjectIds(ctx, ctx.principal);
    if (visible !== 'all' && !visible.has(project._id)) return { id: null, code: project.code, name: project.name };
    return { id: project._id, code: project.code, name: project.name };
  },
});
