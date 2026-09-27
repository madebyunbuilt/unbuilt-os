import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { notifyTeamMembers } from './notify';
import { type TeamPrincipal } from './principals';
import { inProjectScope } from './projects';

// Who may see what in the vault (10-vault.md, Access). Nothing here decrypts anything: these are the rules that run
// before a key is ever fetched, and they are shared by the queries that list items and the action that reveals one.

type Ctx = QueryCtx | MutationCtx;

export function vaultError(code: `vault.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** A second factor entered this recently counts; older than this and the member enters it again. */
export const TWO_FACTOR_WINDOW_MS = 15 * 60 * 1000;

/** The 30 seconds a revealed secret stays on screen before the page hides it again. */
export const REVEAL_VISIBLE_MS = 30 * 1000;

/**
 * Whether this member may see this item at all. `vault.view.all` reaches every item; `vault.view.assigned` reaches
 * items on a project the member belongs to. An item with no project belongs to the client as a whole, which only
 * `vault.view.all` reaches: there is no project membership to stand on.
 */
export async function canSeeItem(ctx: Ctx, principal: TeamPrincipal, item: Doc<'vaultItems'>): Promise<boolean> {
  if (principal.permissions.has('vault.view.all')) return true;
  if (!principal.permissions.has('vault.view.assigned')) return false;
  return item.projectId ? await inProjectScope(ctx, principal, item.projectId) : false;
}

/**
 * The same rule as `canSeeItem`, decided from a member id instead of a principal, for the actions that have no
 * database and hand a member id to an internal function. It returns the reason too, because a refused reveal is
 * written to the access log and "not on this project" is the part worth reading later.
 *
 * One rule in one place: if these two disagreed, the vault would refuse a reveal and allow the edit, or the reverse.
 */
export async function memberMaySeeItem(
  ctx: Ctx,
  memberId: Id<'teamMembers'>,
  item: Doc<'vaultItems'>,
): Promise<{ allowed: boolean; reason: string }> {
  const member = await ctx.db.get('teamMembers', memberId);
  const role = member ? await ctx.db.get('roles', member.roleId) : null;
  const held = new Set(role?.permissions ?? []);

  if (held.has('vault.view.all')) return { allowed: true, reason: '' };
  if (!held.has('vault.view.assigned')) return { allowed: false, reason: 'no vault permission' };
  // An item held against the client as a whole has no project membership to stand on.
  if (!item.projectId) return { allowed: false, reason: 'not on a project' };
  const onProject = await ctx.db
    .query('projectMembers')
    .withIndex('by_project_member', (q) => q.eq('projectId', item.projectId!).eq('memberId', memberId))
    .first();
  return onProject ? { allowed: true, reason: '' } : { allowed: false, reason: 'not on this project' };
}

/** When this session last proved a second factor: at sign-in, or by entering a code again since. */
export async function twoFactorVerifiedAt(ctx: Ctx, principal: TeamPrincipal): Promise<number> {
  const check = await ctx.db
    .query('twoFactorChecks')
    .withIndex('by_session', (q) => q.eq('sessionId', principal.session.sessionId))
    .order('desc')
    .first();
  // Signing in as a team member required a second factor, so the session's own age counts as a verification.
  return Math.max(check?.verifiedAt ?? 0, principal.session.signedInAt);
}

/** What a list may say about an item: everything except the secret itself. */
export function itemView(item: Doc<'vaultItems'>) {
  return {
    id: item._id,
    clientId: item.clientId,
    projectId: item.projectId,
    label: item.label,
    kind: item.kind,
    url: item.url,
    hasUsername: item.usernameCiphertext !== undefined,
    hasNotes: item.notesCiphertext !== undefined,
    submittedByKind: item.submittedByKind,
    rotateByDate: item.rotateByDate,
    lastRevealedAt: item.lastRevealedAt,
    status: item.status,
    keyVersion: item.keyVersion,
    createdAt: item._creationTime,
  };
}

export type VaultItemView = ReturnType<typeof itemView>;

/** Everything a client may know about what they submitted: that it is there, and when. Never a value. */
export function portalItemView(item: Doc<'vaultItems'>) {
  return {
    id: item._id,
    label: item.label,
    kind: item.kind,
    url: item.url,
    submittedAt: item._creationTime,
    status: item.status,
  };
}

/**
 * When somebody comes off a project, the manager is asked to rotate what that person actually saw (10-vault.md,
 * Lifecycle). Read from the access log rather than from what is on the project now, because the point is what they
 * know, and revealing it is the moment they learned it. Items they only ever had the right to see do not count: this
 * is a list of credentials to change, and padding it with ones nobody looked at is how it starts being ignored.
 *
 * It notifies rather than rotates. A credential lives in somebody else's system, and the studio has to change it there
 * first; a vault that quietly invalidated its own copy would leave the real one working and the record of it wrong.
 */
export async function promptRotationAfterLeaving(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  memberId: Id<'teamMembers'>,
): Promise<void> {
  const revealed = await ctx.db
    .query('vaultAccessLogs')
    .withIndex('by_member', (q) => q.eq('memberId', memberId))
    .collect();
  const seenItemIds = new Set(
    revealed.filter((log) => log.action === 'reveal' || log.action === 'copy').map((log) => log.vaultItemId),
  );
  if (seenItemIds.size === 0) return;

  const project = await ctx.db.get('projects', projectId);
  if (!project) return;
  const items = [];
  for (const itemId of seenItemIds) {
    const item = await ctx.db.get('vaultItems', itemId);
    // Only this project's live items: another project's credentials are that project manager's business.
    if (item && item.projectId === projectId && item.status === 'active') items.push(item);
  }
  if (items.length === 0) return;

  const member = await ctx.db.get('teamMembers', memberId);
  const names = items.map((item) => item.label);
  await notifyTeamMembers(ctx, [project.managerMemberId], {
    event: 'vault.rotation.afterLeaving',
    title: `Rotate ${names.length === 1 ? '1 credential' : `${names.length} credentials`} on ${project.name}`,
    body: `${member?.name ?? 'Someone'} came off ${project.name} and had seen ${listLabels(names)}. Change ${
      names.length === 1 ? 'it' : 'them'
    } where the credential lives, then update the vault.`,
    link: `/projects/${projectId}/vault`,
  });
}

function listLabels(labels: string[]): string {
  const shown = labels.slice(0, 3);
  const rest = labels.length - shown.length;
  const joined = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

export type SealedFields = {
  usernameCiphertext?: string;
  secretCiphertext: string;
  notesCiphertext?: string;
  iv: string;
  keyVersion: number;
};

export function itemsForClient(ctx: Ctx, clientId: Id<'clients'>) {
  return ctx.db
    .query('vaultItems')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
}
