import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { type TeamPermission } from './permissions';
import { type TeamPrincipal } from './principals';

// Team members (11-team.md): invitations, onboarding, rates and the one-Owner rule.

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const DEFAULT_ONBOARDING_ITEMS = [
  { label: 'NDA signed', required: true },
  { label: 'Agreement signed', required: true },
  { label: '2FA enabled', key: 'twoFactor', required: true },
  { label: 'Added to projects', required: false },
  { label: 'Tools access granted', required: false },
] as const;

export function teamError(code: `team.${string}`, message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code, message });
}

export function inviteState(
  member: Pick<Doc<'teamMembers'>, 'status' | 'inviteExpiresAt'>,
  now: number,
): 'pending' | 'expired' | null {
  if (member.status !== 'invited') return null;
  return member.inviteExpiresAt !== undefined && member.inviteExpiresAt <= now ? 'expired' : 'pending';
}

/** Keys of `role` the caller does not hold. Nobody may put someone in a role more powerful than their own. */
export function permissionsNotHeld(principal: TeamPrincipal, role: Doc<'roles'>): string[] {
  return role.permissions.filter((key) => !principal.permissions.has(key as TeamPermission));
}

export function assertAssignableRole(
  principal: TeamPrincipal,
  role: Doc<'roles'> | null,
): asserts role is Doc<'roles'> {
  if (!role || role.kind !== 'team') throw teamError('team.invalidRole', 'Choose a team role');
  if (role.isSystem && role.key === 'owner') {
    throw teamError('team.ownerRole', 'There is one Owner. Transfer ownership instead.');
  }
  const notHeld = permissionsNotHeld(principal, role);
  if (notHeld.length > 0) {
    throw teamError(
      'team.cannotGrant',
      `You cannot give a role with permissions you do not hold: ${notHeld.join(', ')}`,
    );
  }
}

export async function roleByKey(ctx: QueryCtx | MutationCtx, key: string) {
  return await ctx.db
    .query('roles')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
}

export function isOwner(role: Doc<'roles'> | null): boolean {
  return !!role && role.isSystem && role.key === 'owner';
}

export async function onboardingChecklist(ctx: QueryCtx | MutationCtx, memberId: Id<'teamMembers'>) {
  return await ctx.db
    .query('checklists')
    .withIndex('by_target', (q) =>
      q.eq('target.table', 'teamMembers').eq('target.id', memberId).eq('kind', 'onboarding'),
    )
    .unique();
}

export async function createOnboardingChecklist(ctx: MutationCtx, memberId: Id<'teamMembers'>) {
  if (await onboardingChecklist(ctx, memberId)) return;
  await ctx.db.insert('checklists', {
    kind: 'onboarding',
    target: { table: 'teamMembers', id: memberId },
    items: DEFAULT_ONBOARDING_ITEMS.map((item) => ({ ...item, done: false })),
  });
}

/** The fields everyone with team.view may see. Rates are added only for team.rates.sensitive (11-team.md). */
export function memberView(
  member: Doc<'teamMembers'>,
  role: Doc<'roles'> | null,
  { canSeeRates, now }: { canSeeRates: boolean; now: number },
) {
  return {
    id: member._id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    whatsapp: member.whatsapp,
    title: member.title,
    employmentType: member.employmentType,
    role: role ? { id: role._id, key: role.key, name: role.name, isOwner: isOwner(role) } : null,
    status: member.status,
    invite: inviteState(member, now),
    inviteExpiresAt: member.inviteExpiresAt,
    inviteLastSentAt: member.inviteLastSentAt,
    startDate: member.startDate,
    endDate: member.endDate,
    capacityMinutesPerWeek: member.capacityMinutesPerWeek,
    timezone: member.timezone,
    skills: member.skills,
    avatarFileId: member.avatarFileId,
    ...(canSeeRates
      ? {
          rates: {
            costRateMinor: member.costRateMinor,
            billRateMinor: member.billRateMinor,
            currency: member.rateCurrency,
          },
        }
      : {}),
  };
}
