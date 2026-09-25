import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { internalMutation } from './lib/functions';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { OPEN_STATUSES } from './lib/sla';

// Breach warnings (09-support-and-sla.md, Breach warnings). The studio hears at 75% of a target and again if it goes
// past it, each once per ticket per target: the stamps on the ticket are what make a cron that runs every quarter of
// an hour send two notifications rather than ninety-six.

type Target = 'firstResponse' | 'resolution';

const WHAT: Record<Target, string> = {
  firstResponse: 'first reply',
  resolution: 'resolution',
};

/** The assignee, the project's manager and the admins (09-support-and-sla.md). */
async function recipients(ctx: MutationCtx, ticket: Doc<'tickets'>) {
  const admins = await activeMembersWith(ctx, 'settings.manage');
  const others: Id<'teamMembers'>[] = [];
  if (ticket.assigneeMemberId) others.push(ticket.assigneeMemberId);
  if (ticket.projectId) {
    const project = await ctx.db.get('projects', ticket.projectId);
    if (project?.managerMemberId) others.push(project.managerMemberId);
  }
  const adminSet = new Set(admins);
  return { admins, others: others.filter((id) => !adminSet.has(id)) };
}

async function alert(
  ctx: MutationCtx,
  ticket: Doc<'tickets'>,
  target: Target,
  kind: 'warning' | 'breach',
  dueAt: number,
) {
  const { admins, others } = await recipients(ctx, ticket);
  const what = WHAT[target];
  const notification = {
    event: kind === 'breach' ? 'sla.breached' : 'sla.warning',
    title:
      kind === 'breach'
        ? `${ticket.number} has missed its ${what} time`
        : `${ticket.number} is close to its ${what} time`,
    body: ticket.subject,
    link: `/tickets/${ticket._id}`,
  };
  // A missed P1 is the one thing that goes beyond the app: the admins are told on WhatsApp too.
  const urgent = kind === 'breach' && ticket.priority === 'p1';
  await notifyTeamMembers(ctx, admins, notification, urgent ? { whatsapp: true } : {});
  await notifyTeamMembers(ctx, others, notification);
  return dueAt;
}

/**
 * One target's worth of checking. A warning is not sent for a target that is already missed: being told a deadline is
 * three-quarters gone, when it went hours ago, is worse than being told nothing.
 */
async function check(
  ctx: MutationCtx,
  ticket: Doc<'tickets'>,
  target: Target,
  args: { met: boolean; dueAt?: number; warnAt?: number; warnedAt?: number; breachedAt?: number },
  now: number,
): Promise<Partial<Doc<'tickets'>>> {
  const patch: Partial<Doc<'tickets'>> = {};
  if (args.met || args.dueAt === undefined) return patch;

  if (now >= args.dueAt) {
    if (args.breachedAt === undefined) {
      await alert(ctx, ticket, target, 'breach', args.dueAt);
      if (target === 'firstResponse') patch.breachedFirstResponseAt = now;
      else patch.breachedResolutionAt = now;
    }
    // The warning is stamped as spent either way, so it can never arrive after the breach it was meant to prevent.
    if (args.warnedAt === undefined) {
      if (target === 'firstResponse') patch.warnedFirstResponseAt = now;
      else patch.warnedResolutionAt = now;
    }
    return patch;
  }

  if (args.warnAt !== undefined && now >= args.warnAt && args.warnedAt === undefined) {
    await alert(ctx, ticket, target, 'warning', args.dueAt);
    if (target === 'firstResponse') patch.warnedFirstResponseAt = now;
    else patch.warnedResolutionAt = now;
  }
  return patch;
}

export const runDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ warned: number; breached: number }> => {
    const now = Date.now();
    const tickets = (
      await Promise.all(
        OPEN_STATUSES.map((status) =>
          ctx.db
            .query('tickets')
            .withIndex('by_status', (q) => q.eq('status', status))
            .collect(),
        ),
      )
    ).flat();

    let warned = 0;
    let breached = 0;
    for (const ticket of tickets) {
      if (!ticket.slaPolicyId) continue;
      const patch: Partial<Doc<'tickets'>> = {
        ...(await check(
          ctx,
          ticket,
          'firstResponse',
          {
            met: ticket.firstRespondedAt !== undefined,
            dueAt: ticket.firstResponseDueAt,
            warnAt: ticket.firstResponseWarnAt,
            warnedAt: ticket.warnedFirstResponseAt,
            breachedAt: ticket.breachedFirstResponseAt,
          },
          now,
        )),
        // A ticket waiting on the client is not running out of time: its resolution clock is stopped, and its due time
        // moves out by whatever the wait costs when it resumes.
        ...(ticket.pausedAt !== undefined
          ? {}
          : await check(
              ctx,
              ticket,
              'resolution',
              {
                met: false,
                dueAt: ticket.resolutionDueAt,
                warnAt: ticket.resolutionWarnAt,
                warnedAt: ticket.warnedResolutionAt,
                breachedAt: ticket.breachedResolutionAt,
              },
              now,
            )),
      };
      if (Object.keys(patch).length === 0) continue;
      if (patch.breachedFirstResponseAt !== undefined) breached++;
      if (patch.breachedResolutionAt !== undefined) breached++;
      if (patch.warnedFirstResponseAt !== undefined && patch.breachedFirstResponseAt === undefined) warned++;
      if (patch.warnedResolutionAt !== undefined && patch.breachedResolutionAt === undefined) warned++;
      await ctx.db.patch('tickets', ticket._id, patch);
    }
    return { warned, breached };
  },
});
