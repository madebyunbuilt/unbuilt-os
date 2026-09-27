import { ConvexError } from 'convex/values';
import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
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
