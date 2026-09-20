import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type TeamPermission } from './permissions';
import { type TeamPrincipal } from './principals';
import { CLOSED_PROJECT_STATUSES } from './projectStatus';

// Projects (06-projects.md) and project scope (03-auth-and-permissions.md, Record-level rules): permissions ending in
// `.assigned` apply only to projects the member belongs to, and projects.view.all lifts that restriction. Anything
// linked to a project inherits its scope. A caller outside the scope gets "not found", never a hint the record exists.

type Ctx = QueryCtx | MutationCtx;

export function projectError(code: `projects.${string}`, message: string) {
  return new ConvexError({ code, message });
}

export const notFound = (what = 'Project') => projectError('projects.notFound', `${what} not found`);

export async function membership(ctx: Ctx, projectId: Id<'projects'>, memberId: Id<'teamMembers'>) {
  return await ctx.db
    .query('projectMembers')
    .withIndex('by_project_member', (q) => q.eq('projectId', projectId).eq('memberId', memberId))
    .unique();
}

export async function isProjectMember(ctx: Ctx, projectId: Id<'projects'>, memberId: Id<'teamMembers'>) {
  return (await membership(ctx, projectId, memberId)) !== null;
}

/** Whether the principal's `.assigned` permissions reach this project: a member of it, or projects.view.all. */
export async function inProjectScope(ctx: Ctx, principal: TeamPrincipal, projectId: Id<'projects'>) {
  if (principal.permissions.has('projects.view.all')) return true;
  if (!principal.permissions.has('projects.view.assigned')) return false;
  return await isProjectMember(ctx, projectId, principal.member._id);
}

/** The project, when the caller may see it; otherwise "not found". */
export async function visibleProject(ctx: Ctx, principal: TeamPrincipal, projectId: Id<'projects'>) {
  const project = await ctx.db.get('projects', projectId);
  if (!project || !(await inProjectScope(ctx, principal, projectId))) throw notFound();
  return project;
}

/** The projects the caller may see. */
export async function visibleProjectIds(ctx: Ctx, principal: TeamPrincipal): Promise<Set<Id<'projects'>> | 'all'> {
  if (principal.permissions.has('projects.view.all')) return 'all';
  if (!principal.permissions.has('projects.view.assigned')) return new Set();
  const rows = await ctx.db
    .query('projectMembers')
    .withIndex('by_member', (q) => q.eq('memberId', principal.member._id))
    .collect();
  return new Set(rows.map((row) => row.projectId));
}

/**
 * Checks a scoped action on a visible project: `all` anywhere, or `assigned` within scope. Returns the project; a
 * project out of sight is "not found", a visible one without the permission is forbidden.
 */
export async function projectFor(
  ctx: Ctx,
  principal: TeamPrincipal,
  projectId: Id<'projects'>,
  permission: { all?: TeamPermission; assigned?: TeamPermission; exact?: TeamPermission },
) {
  const project = await visibleProject(ctx, principal, projectId);
  const allowed =
    (permission.exact && principal.permissions.has(permission.exact)) ||
    (permission.all && principal.permissions.has(permission.all)) ||
    (permission.assigned && principal.permissions.has(permission.assigned));
  if (!allowed) throw new ConvexError({ code: 'auth.forbidden', message: 'You do not have access to this' });
  return project;
}

/** Projects that are finished and can no longer change, except by reopening. */
export const CLOSED_STATUSES: ReadonlySet<Doc<'projects'>['status']> = CLOSED_PROJECT_STATUSES;

export function assertOpen(project: Doc<'projects'>) {
  if (CLOSED_STATUSES.has(project.status)) {
    throw projectError('projects.closed', `This project is ${project.status}. Reopen it to make changes.`);
  }
}

/** Adds the days to a YYYY-MM-DD date. */
export function addDaysToDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Project members, as "active team member" rows, for assignee checks. */
export async function assertProjectMembers(ctx: Ctx, projectId: Id<'projects'>, memberIds: Id<'teamMembers'>[]) {
  for (const memberId of memberIds) {
    if (!(await isProjectMember(ctx, projectId, memberId))) {
      throw projectError('projects.notMember', 'Assignees must be members of the project');
    }
  }
}
