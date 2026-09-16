import { v } from 'convex/values';
import { type Doc } from './_generated/dataModel';
import { requirePermission, text } from './lib/crm';
import { teamMutation, teamQuery } from './lib/functions';
import { notFound, projectError } from './lib/projects';

// Project templates (06-projects.md, Templates). Anyone who creates projects can read them; templates.projects.manage
// edits them. Templates are retired rather than deleted so projects keep a meaningful link.

const milestone = v.object({
  name: v.string(),
  offsetDays: v.number(),
  billingPercentBps: v.optional(v.number()),
  deliverables: v.array(v.string()),
});
const task = v.object({
  title: v.string(),
  milestoneIndex: v.optional(v.number()),
  estimateMinutes: v.optional(v.number()),
});

function view(template: Doc<'projectTemplates'>) {
  return {
    id: template._id,
    name: template.name,
    type: template.type,
    description: template.description,
    milestones: template.milestones,
    tasks: template.tasks,
    active: template.active,
  };
}

export const list = teamQuery(null)({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { includeInactive }) => {
    if (!ctx.can('projects.create')) requirePermission(ctx.principal, 'templates.projects.manage');
    const templates = await ctx.db.query('projectTemplates').withIndex('by_name').collect();
    return templates.filter((template) => includeInactive || template.active).map(view);
  },
});

type Input = {
  name: string;
  type: string;
  description?: string;
  milestones: Doc<'projectTemplates'>['milestones'];
  tasks: Doc<'projectTemplates'>['tasks'];
};

function checked(args: Input) {
  if (args.milestones.length > 50 || args.tasks.length > 300) {
    throw projectError('projects.invalid', 'Use up to 50 milestones and 300 tasks');
  }
  let percentTotal = 0;
  const milestones = args.milestones.map((m) => {
    if (!Number.isInteger(m.offsetDays) || m.offsetDays < 0 || m.offsetDays > 3650) {
      throw projectError('projects.invalid', 'Milestone offsets must be whole days from the start, up to 10 years');
    }
    if (m.billingPercentBps !== undefined) {
      if (!Number.isInteger(m.billingPercentBps) || m.billingPercentBps < 0 || m.billingPercentBps > 10_000) {
        throw projectError('projects.invalid', 'Billing percentages must be between 0% and 100%');
      }
      percentTotal += m.billingPercentBps;
    }
    return {
      name: text(m.name, 'Milestone name', { required: true, max: 120 })!,
      offsetDays: m.offsetDays,
      billingPercentBps: m.billingPercentBps,
      deliverables: m.deliverables.map((d) => text(d, 'Deliverable', { required: true, max: 120 })!),
    };
  });
  if (percentTotal > 10_000) throw projectError('projects.invalid', 'Billing percentages add up to more than 100%');
  const tasks = args.tasks.map((t) => {
    if (t.milestoneIndex !== undefined && (t.milestoneIndex < 0 || t.milestoneIndex >= milestones.length)) {
      throw projectError('projects.invalid', 'A task points at a milestone that does not exist');
    }
    if (t.estimateMinutes !== undefined && (!Number.isInteger(t.estimateMinutes) || t.estimateMinutes < 0)) {
      throw projectError('projects.invalid', 'Estimates must be whole minutes');
    }
    return {
      title: text(t.title, 'Task title', { required: true, max: 200 })!,
      milestoneIndex: t.milestoneIndex,
      estimateMinutes: t.estimateMinutes,
    };
  });
  return {
    name: text(args.name, 'Name', { required: true, max: 80 })!,
    type: text(args.type, 'Type', { required: true, max: 40 })!,
    description: text(args.description, 'Description', { max: 500 }),
    milestones,
    tasks,
  };
}

const fields = {
  name: v.string(),
  type: v.string(),
  description: v.optional(v.string()),
  milestones: v.array(milestone),
  tasks: v.array(task),
};

export const create = teamMutation('templates.projects.manage')({
  args: fields,
  handler: async (ctx, args) =>
    await ctx.db.insert('projectTemplates', { ...checked(args), checklists: [], active: true }),
});

/** Changes apply to projects created afterwards. */
export const update = teamMutation('templates.projects.manage')({
  args: { templateId: v.id('projectTemplates'), ...fields },
  handler: async (ctx, { templateId, ...args }) => {
    if (!(await ctx.db.get('projectTemplates', templateId))) throw notFound('Template');
    await ctx.db.patch('projectTemplates', templateId, checked(args));
  },
});

export const setActive = teamMutation('templates.projects.manage')({
  args: { templateId: v.id('projectTemplates'), active: v.boolean() },
  handler: async (ctx, { templateId, active }) => {
    if (!(await ctx.db.get('projectTemplates', templateId))) throw notFound('Template');
    await ctx.db.patch('projectTemplates', templateId, { active });
  },
});
