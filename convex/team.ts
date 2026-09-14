import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { deleteFile, recordUpload } from './lib/files';
import { teamMutation, teamQuery } from './lib/functions';
import { normalizeEmail, revokeAllSessions, type TeamPrincipal } from './lib/principals';
import {
  assertAssignableRole,
  createOnboardingChecklist,
  INVITE_TTL_MS,
  isOwner,
  memberView,
  onboardingChecklist,
  permissionsNotHeld,
  roleByKey,
  teamError,
} from './lib/team';
import { isE164, isEmail, isIsoDate, isTimeZone } from './lib/validation';

// Team members (11-team.md): invitations, profiles, roles, rates, suspension, offboarding, ownership and onboarding.

type Ctx = QueryCtx | MutationCtx;

const notFound = () => teamError('team.notFound', 'Team member not found');

async function getMember(ctx: Ctx, memberId: Id<'teamMembers'>): Promise<Doc<'teamMembers'>> {
  const member = await ctx.db.get('teamMembers', memberId);
  if (!member) throw notFound();
  return member;
}

async function roleOf(ctx: Ctx, member: Doc<'teamMembers'>) {
  return await ctx.db.get('roles', member.roleId);
}

async function twoFactorEnabled(ctx: Ctx, member: Doc<'teamMembers'>): Promise<boolean> {
  if (!member.authUserId) return false;
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: '_id', value: member.authUserId }],
  });
  return user?.twoFactorEnabled === true;
}

async function checklistView(ctx: Ctx, member: Doc<'teamMembers'>) {
  const checklist = await onboardingChecklist(ctx, member._id);
  if (!checklist) return null;
  const twoFactor = await twoFactorEnabled(ctx, member);
  return {
    id: checklist._id,
    items: checklist.items.map((item, index) => ({
      index,
      label: item.label,
      required: item.required,
      automatic: item.key !== undefined,
      done: item.key === 'twoFactor' ? twoFactor : item.done,
      doneAt: item.key === 'twoFactor' ? undefined : item.doneAt,
    })),
  };
}

function text(value: string | undefined, label: string, { required = false, max = 120 } = {}): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    if (required) throw teamError('team.invalid', `${label} is required`);
    return undefined;
  }
  if (trimmed.length > max) throw teamError('team.invalid', `${label} can be at most ${max} characters`);
  return trimmed;
}

function phone(value: string | undefined, label: string): string | undefined {
  const cleaned = value?.replace(/[\s()-]/g, '');
  if (!cleaned) return undefined;
  if (!isE164(cleaned)) {
    throw teamError('team.invalid', `${label} must be an international number, such as +2348012345678`);
  }
  return cleaned;
}

function date(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  if (!isIsoDate(value)) throw teamError('team.invalid', `${label} must be a date`);
  return value;
}

function timezone(value: string): string {
  if (!isTimeZone(value)) throw teamError('team.invalid', `"${value}" is not a timezone`);
  return value;
}

function skills(values: string[]): string[] {
  const cleaned = [...new Set(values.map((skill) => skill.trim()).filter(Boolean))];
  if (cleaned.length > 30 || cleaned.some((skill) => skill.length > 40)) {
    throw teamError('team.invalid', 'Use up to 30 skills of up to 40 characters');
  }
  return cleaned;
}

function capacity(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 100 * 60) {
    throw teamError('team.invalid', 'Weekly capacity must be between 0 and 100 hours');
  }
  return value;
}

/** Changes to another member's access. Nobody changes their own access, and the Owner changes only by transfer. */
async function manageableMember(ctx: MutationCtx & { principal: TeamPrincipal }, memberId: Id<'teamMembers'>) {
  const member = await getMember(ctx, memberId);
  if (member._id === ctx.principal.member._id) {
    throw teamError('team.self', 'You cannot change your own access. Ask another admin.');
  }
  const role = await roleOf(ctx, member);
  if (isOwner(role)) throw teamError('team.owner', 'The Owner’s access changes only through an ownership transfer');
  return { member, role };
}

const profileFields = {
  name: v.string(),
  title: v.optional(v.string()),
  employmentType: v.union(v.literal('employee'), v.literal('contractor')),
  phone: v.optional(v.string()),
  whatsapp: v.optional(v.string()),
  timezone: v.string(),
  skills: v.array(v.string()),
  startDate: v.optional(v.string()),
  capacityMinutesPerWeek: v.optional(v.number()),
};

export const list = teamQuery('team.view')({
  args: { includeOffboarded: v.optional(v.boolean()) },
  handler: async (ctx, { includeOffboarded }) => {
    const canSeeRates = ctx.can('team.rates.sensitive');
    const now = Date.now();
    const members = await ctx.db.query('teamMembers').collect();
    const views = await Promise.all(
      members
        .filter((member) => includeOffboarded || member.status !== 'offboarded')
        .map(async (member) => memberView(member, await roleOf(ctx, member), { canSeeRates, now })),
    );
    return views.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const get = teamQuery('team.view')({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    const member = await getMember(ctx, memberId);
    return {
      ...memberView(member, await roleOf(ctx, member), {
        canSeeRates: ctx.can('team.rates.sensitive'),
        now: Date.now(),
      }),
      twoFactorEnabled: await twoFactorEnabled(ctx, member),
      onboarding: await checklistView(ctx, member),
    };
  },
});

/** Your own profile. Rates stay hidden unless your role may see rates. */
export const me = teamQuery(null)({
  args: {},
  handler: async (ctx) => {
    const member = ctx.principal.member;
    return {
      ...memberView(member, ctx.principal.role, { canSeeRates: ctx.can('team.rates.sensitive'), now: Date.now() }),
      onboarding: await checklistView(ctx, member),
    };
  },
});

/** Team roles the caller may give someone: never the Owner, never more than the caller holds. */
export const assignableRoles = teamQuery('team.manage')({
  args: {},
  handler: async (ctx) => {
    const roles = await ctx.db
      .query('roles')
      .withIndex('by_kind', (q) => q.eq('kind', 'team'))
      .collect();
    return roles
      .filter((role) => !isOwner(role) && permissionsNotHeld(ctx.principal, role).length === 0)
      .map((role) => ({ id: role._id, key: role.key, name: role.name, description: role.description }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const invite = teamMutation('team.manage')({
  args: {
    email: v.string(),
    roleId: v.id('roles'),
    ...profileFields,
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!isEmail(email)) throw teamError('team.invalid', `"${args.email}" is not an email address`);
    assertAssignableRole(ctx.principal, await ctx.db.get('roles', args.roleId));

    const existingMember = await ctx.db
      .query('teamMembers')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();
    if (existingMember) {
      throw teamError(
        'team.exists',
        existingMember.status === 'offboarded'
          ? `${email} was offboarded. Reinstating former members is not supported yet.`
          : `${email} is already on the team`,
      );
    }
    const contact = await ctx.db
      .query('contacts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();
    if (contact) {
      throw teamError('team.clientEmail', `${email} belongs to a client contact. Team members need their own address.`);
    }

    const memberId = await ctx.db.insert('teamMembers', {
      email,
      roleId: args.roleId,
      name: text(args.name, 'Name', { required: true })!,
      title: text(args.title, 'Title'),
      employmentType: args.employmentType,
      phone: phone(args.phone, 'Phone'),
      whatsapp: phone(args.whatsapp, 'WhatsApp'),
      timezone: timezone(args.timezone),
      skills: skills(args.skills),
      startDate: date(args.startDate, 'Start date'),
      capacityMinutesPerWeek: capacity(args.capacityMinutesPerWeek),
      status: 'invited',
      invitedByMemberId: ctx.principal.member._id,
      inviteExpiresAt: Date.now() + INVITE_TTL_MS,
    });
    await createOnboardingChecklist(ctx, memberId);
    await ctx.scheduler.runAfter(0, internal.teamInvites.send, { memberId });
    return memberId;
  },
});

export const resendInvite = teamMutation('team.manage')({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    const member = await getMember(ctx, memberId);
    if (member.status !== 'invited') throw teamError('team.notInvited', 'Only pending invitations can be resent');
    await ctx.db.patch('teamMembers', memberId, {
      inviteExpiresAt: Date.now() + INVITE_TTL_MS,
      invitedByMemberId: ctx.principal.member._id,
    });
    await ctx.scheduler.runAfter(0, internal.teamInvites.send, { memberId });
  },
});

/** Withdraws an invitation nobody accepted. The person never had an account, so the record is removed. */
export const cancelInvite = teamMutation('team.manage')({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    const member = await getMember(ctx, memberId);
    if (member.status !== 'invited' || member.authUserId) {
      throw teamError('team.notInvited', 'Only invitations that were never accepted can be cancelled');
    }
    if (isOwner(await roleOf(ctx, member))) throw teamError('team.owner', 'The Owner invitation cannot be cancelled');
    const checklist = await onboardingChecklist(ctx, memberId);
    if (checklist) await ctx.db.delete('checklists', checklist._id);
    await ctx.db.delete('teamMembers', memberId);
  },
});

export const updateProfile = teamMutation('team.manage')({
  args: { memberId: v.id('teamMembers'), ...profileFields },
  handler: async (ctx, { memberId, ...fields }) => {
    await getMember(ctx, memberId);
    await ctx.db.patch('teamMembers', memberId, {
      name: text(fields.name, 'Name', { required: true })!,
      title: text(fields.title, 'Title'),
      employmentType: fields.employmentType,
      phone: phone(fields.phone, 'Phone'),
      whatsapp: phone(fields.whatsapp, 'WhatsApp'),
      timezone: timezone(fields.timezone),
      skills: skills(fields.skills),
      startDate: date(fields.startDate, 'Start date'),
      capacityMinutesPerWeek: capacity(fields.capacityMinutesPerWeek),
    });
  },
});

/** The contact details a member keeps up to date themselves. */
export const updateMyProfile = teamMutation(null)({
  args: {
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    timezone: v.string(),
    skills: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch('teamMembers', ctx.principal.member._id, {
      phone: phone(args.phone, 'Phone'),
      whatsapp: phone(args.whatsapp, 'WhatsApp'),
      timezone: timezone(args.timezone),
      skills: skills(args.skills),
    });
  },
});

export const changeRole = teamMutation('team.manage')({
  args: { memberId: v.id('teamMembers'), roleId: v.id('roles') },
  handler: async (ctx, { memberId, roleId }) => {
    const { member, role: currentRole } = await manageableMember(ctx, memberId);
    // Taking a role away is also a grant decision: nobody can move someone out of a role more powerful than their own.
    if (currentRole) assertAssignableRole(ctx.principal, currentRole);
    assertAssignableRole(ctx.principal, await ctx.db.get('roles', roleId));
    if (member.roleId !== roleId) await ctx.db.patch('teamMembers', memberId, { roleId });
  },
});

/** New rates apply to time logged afterwards; time entries keep the rate they were logged with (11-team.md). */
export const setRates = teamMutation('team.rates.sensitive')({
  args: {
    memberId: v.id('teamMembers'),
    costRateMinor: v.optional(v.number()),
    billRateMinor: v.optional(v.number()),
    currency: v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR')),
  },
  handler: async (ctx, { memberId, costRateMinor, billRateMinor, currency }) => {
    await getMember(ctx, memberId);
    for (const [label, value] of [
      ['Cost rate', costRateMinor],
      ['Bill rate', billRateMinor],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw teamError('team.invalid', `${label} must be a whole, non-negative amount in minor units`);
      }
    }
    await ctx.db.patch('teamMembers', memberId, { costRateMinor, billRateMinor, rateCurrency: currency });
  },
});

export const suspend = teamMutation('team.manage')({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    const { member, role } = await manageableMember(ctx, memberId);
    if (role) assertAssignableRole(ctx.principal, role);
    if (member.status !== 'active') throw teamError('team.notActive', 'Only active members can be suspended');
    await ctx.db.patch('teamMembers', memberId, { status: 'suspended' });
    if (member.authUserId) await revokeAllSessions(ctx, member.authUserId);
  },
});

export const reactivate = teamMutation('team.manage')({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    const { member, role } = await manageableMember(ctx, memberId);
    if (role) assertAssignableRole(ctx.principal, role);
    if (member.status !== 'suspended')
      throw teamError('team.notSuspended', 'Only suspended members can be reactivated');
    await ctx.db.patch('teamMembers', memberId, { status: 'active' });
  },
});

/**
 * Ends a member's access at once and keeps their history. Later modules add their steps here: project memberships,
 * open tasks and tickets to reassign, and vault items they revealed to rotate (11-team.md, Offboarding).
 */
export const offboard = teamMutation('team.manage')({
  args: { memberId: v.id('teamMembers'), endDate: v.string() },
  handler: async (ctx, { memberId, endDate }) => {
    const { member, role } = await manageableMember(ctx, memberId);
    if (role) assertAssignableRole(ctx.principal, role);
    if (member.status === 'offboarded') throw teamError('team.offboarded', 'This member is already offboarded');
    if (member.status === 'invited') throw teamError('team.notActive', 'Cancel the invitation instead');
    await ctx.db.patch('teamMembers', memberId, {
      status: 'offboarded',
      endDate: date(endDate, 'End date'),
      offboardedAt: Date.now(),
    });
    if (member.authUserId) await revokeAllSessions(ctx, member.authUserId);
  },
});

/** Moves the Owner role to another active member with 2FA. The previous Owner becomes an Admin. */
export const transferOwnership = teamMutation('owner.transfer')({
  args: { toMemberId: v.id('teamMembers') },
  handler: async (ctx, { toMemberId }) => {
    if (!isOwner(ctx.principal.role)) throw teamError('team.notOwner', 'Only the Owner can transfer ownership');
    if (toMemberId === ctx.principal.member._id) throw teamError('team.self', 'You are already the Owner');
    const target = await getMember(ctx, toMemberId);
    if (target.status !== 'active') throw teamError('team.notActive', 'The new Owner must be an active member');
    if (!(await twoFactorEnabled(ctx, target))) {
      throw teamError('team.twoFactor', 'The new Owner must have two-factor authentication set up');
    }
    const admin = await roleByKey(ctx, 'admin');
    if (!admin) throw teamError('team.invalidRole', 'The Admin role is missing; run the seed');
    await ctx.db.patch('teamMembers', toMemberId, { roleId: ctx.principal.role._id });
    await ctx.db.patch('teamMembers', ctx.principal.member._id, { roleId: admin._id });
  },
});

const checklistArgs = { memberId: v.id('teamMembers') };

async function memberChecklist(ctx: MutationCtx, memberId: Id<'teamMembers'>) {
  await getMember(ctx, memberId);
  const checklist = await onboardingChecklist(ctx, memberId);
  if (!checklist) throw teamError('team.noChecklist', 'This member has no onboarding checklist');
  return checklist;
}

export const setChecklistItem = teamMutation('team.manage')({
  args: { ...checklistArgs, index: v.number(), done: v.boolean() },
  handler: async (ctx, { memberId, index, done }) => {
    const checklist = await memberChecklist(ctx, memberId);
    const item = checklist.items[index];
    if (!item) throw teamError('team.invalid', 'Checklist item not found');
    if (item.key) throw teamError('team.automatic', `“${item.label}” is ticked automatically`);
    const items = checklist.items.map((existing, i) =>
      i === index
        ? {
            ...existing,
            done,
            doneBy: done ? ctx.principal.member._id : undefined,
            doneAt: done ? Date.now() : undefined,
          }
        : existing,
    );
    await ctx.db.patch('checklists', checklist._id, { items });
  },
});

export const addChecklistItem = teamMutation('team.manage')({
  args: { ...checklistArgs, label: v.string(), required: v.boolean() },
  handler: async (ctx, { memberId, label, required }) => {
    const checklist = await memberChecklist(ctx, memberId);
    if (checklist.items.length >= 30) throw teamError('team.invalid', 'A checklist can have at most 30 items');
    await ctx.db.patch('checklists', checklist._id, {
      items: [...checklist.items, { label: text(label, 'Item', { required: true })!, required, done: false }],
    });
  },
});

export const removeChecklistItem = teamMutation('team.manage')({
  args: { ...checklistArgs, index: v.number() },
  handler: async (ctx, { memberId, index }) => {
    const checklist = await memberChecklist(ctx, memberId);
    const item = checklist.items[index];
    if (!item) throw teamError('team.invalid', 'Checklist item not found');
    if (item.key) throw teamError('team.automatic', `“${item.label}” cannot be removed`);
    await ctx.db.patch('checklists', checklist._id, { items: checklist.items.filter((_, i) => i !== index) });
  },
});

/** You manage your own avatar; team.manage manages anyone's. */
function canEditAvatar(
  ctx: { principal: TeamPrincipal; can: (key: 'team.manage') => boolean },
  memberId: Id<'teamMembers'>,
) {
  if (memberId !== ctx.principal.member._id && !ctx.can('team.manage')) {
    throw teamError('team.forbidden', 'You can only change your own photo');
  }
}

export const generateAvatarUploadUrl = teamMutation(null)({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const setAvatar = teamMutation(null)({
  args: { memberId: v.id('teamMembers'), storageId: v.id('_storage'), name: v.string(), contentType: v.string() },
  handler: async (ctx, { memberId, storageId, name, contentType }) => {
    canEditAvatar(ctx, memberId);
    const member = await getMember(ctx, memberId);
    const result = await recordUpload(ctx, {
      storageId,
      name,
      contentType,
      context: 'image',
      owner: { table: 'teamMembers', id: memberId },
      visibility: 'internal',
      uploadedBy: { kind: 'team', id: ctx.principal.member._id },
    });
    if (!result.ok) return result;
    await ctx.db.patch('teamMembers', memberId, { avatarFileId: result.fileId });
    if (member.avatarFileId) await deleteFile(ctx, member.avatarFileId);
    return result;
  },
});

export const removeAvatar = teamMutation(null)({
  args: { memberId: v.id('teamMembers') },
  handler: async (ctx, { memberId }) => {
    canEditAvatar(ctx, memberId);
    const member = await getMember(ctx, memberId);
    if (!member.avatarFileId) return;
    await ctx.db.patch('teamMembers', memberId, { avatarFileId: undefined });
    await deleteFile(ctx, member.avatarFileId);
  },
});
