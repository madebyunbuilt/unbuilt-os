import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { appendAuditEntry } from './lib/audit';
import { getClient, recordActivity, requirePermission, text } from './lib/crm';
import { internalMutation, internalQuery, portalQuery, teamQuery } from './lib/functions';
import { canSeeItem, itemsForClient, itemView, portalItemView, twoFactorVerifiedAt, vaultError } from './lib/vault';

// The vault's queries and mutations (10-vault.md). Nothing here can decrypt anything: no key is reachable from a
// query or a mutation, so there is no path by which a secret could leave through one. Sealing and opening happen in
// convex/vault.ts, which runs in Node.

const kind = v.union(
  v.literal('login'),
  v.literal('api_key'),
  v.literal('ssh_key'),
  v.literal('env_file'),
  v.literal('note'),
);

export const list = teamQuery(null)({
  args: { clientId: v.optional(v.id('clients')), projectId: v.optional(v.id('projects')) },
  handler: async (ctx, { clientId, projectId }) => {
    if (!ctx.can('vault.view.all')) requirePermission(ctx.principal, 'vault.view.assigned');
    const rows = clientId
      ? await itemsForClient(ctx, clientId)
      : projectId
        ? await ctx.db
            .query('vaultItems')
            .withIndex('by_project', (q) => q.eq('projectId', projectId))
            .collect()
        : await ctx.db.query('vaultItems').take(1000);

    const visible = [];
    for (const item of rows) {
      if (item.status === 'archived') continue;
      if (await canSeeItem(ctx, ctx.principal, item)) visible.push(item);
    }
    return await Promise.all(
      visible
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(async (item) => ({
          ...itemView(item),
          clientName: (await ctx.db.get('clients', item.clientId))?.displayName ?? 'Unknown client',
        })),
    );
  },
});

/** One item's metadata, and how recently this session proved a second factor, so the screen knows what to ask for. */
export const get = teamQuery(null)({
  args: { itemId: v.id('vaultItems') },
  handler: async (ctx, { itemId }) => {
    if (!ctx.can('vault.view.all')) requirePermission(ctx.principal, 'vault.view.assigned');
    const item = await ctx.db.get('vaultItems', itemId);
    if (!item || !(await canSeeItem(ctx, ctx.principal, item))) return null;
    const logs = await ctx.db
      .query('vaultAccessLogs')
      .withIndex('by_item', (q) => q.eq('vaultItemId', itemId))
      .order('desc')
      .take(20);
    return {
      ...itemView(item),
      clientName: (await ctx.db.get('clients', item.clientId))?.displayName ?? 'Unknown client',
      twoFactorVerifiedAt: await twoFactorVerifiedAt(ctx, ctx.principal),
      history: await Promise.all(
        logs.map(async (log) => ({
          id: log._id,
          action: log.action,
          reason: log.reason,
          at: log.at,
          memberName: log.memberId ? ((await ctx.db.get('teamMembers', log.memberId))?.name ?? 'Somebody') : 'Somebody',
        })),
      ),
    };
  },
});

/**
 * What a client may see of their own vault: labels and dates for what they handed over, and never a value or a
 * `hasUsername` hint. Items the studio holds about this client are not listed at all — only the client's own
 * submissions — because the vault is the studio's record of credentials, not a shared folder.
 */
export const portalList = portalQuery('portal.vault.submit')({
  args: {},
  handler: async (ctx) => {
    const items = await itemsForClient(ctx, ctx.principal.clientId);
    return items
      .filter((item) => item.submittedByKind === 'client' && item.status !== 'archived')
      .sort((a, b) => b._creationTime - a._creationTime)
      .map(portalItemView);
  },
});

/** Everything the reveal action needs to decide, in one read, before any key is fetched. */
export const forReveal = internalQuery({
  args: { itemId: v.id('vaultItems') },
  // Annotated, like everything a public action calls: without it the generated api types collapse and every other
  // module's queries quietly widen to any.
  handler: async (ctx, { itemId }): Promise<Doc<'vaultItems'> | null> => await ctx.db.get('vaultItems', itemId),
});

/**
 * Whether this member may reveal this item, and how recently their session proved a second factor. Decided in one
 * read before the action fetches a key, so a refusal costs nothing and leaks nothing.
 */
export const mayReveal = internalQuery({
  args: { itemId: v.id('vaultItems'), memberId: v.id('teamMembers'), sessionId: v.string() },
  handler: async (
    ctx,
    { itemId, memberId, sessionId },
  ): Promise<{ allowed: boolean; reason: string; twoFactorVerifiedAt: number }> => {
    const item = await ctx.db.get('vaultItems', itemId);
    if (!item) return { allowed: false, reason: 'no such item', twoFactorVerifiedAt: 0 };

    const member = await ctx.db.get('teamMembers', memberId);
    const role = member ? await ctx.db.get('roles', member.roleId) : null;
    const held = new Set(role?.permissions ?? []);
    const check = await ctx.db
      .query('twoFactorChecks')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .order('desc')
      .first();
    const verifiedAt = check?.verifiedAt ?? 0;

    if (held.has('vault.view.all')) return { allowed: true, reason: '', twoFactorVerifiedAt: verifiedAt };
    if (!held.has('vault.view.assigned')) {
      return { allowed: false, reason: 'no vault permission', twoFactorVerifiedAt: verifiedAt };
    }
    if (!item.projectId) {
      // An item held against the client as a whole has no project membership to stand on.
      return { allowed: false, reason: 'not on a project', twoFactorVerifiedAt: verifiedAt };
    }
    const onProject = await ctx.db
      .query('projectMembers')
      .withIndex('by_project_member', (q) => q.eq('projectId', item.projectId!).eq('memberId', memberId))
      .first();
    return onProject
      ? { allowed: true, reason: '', twoFactorVerifiedAt: verifiedAt }
      : { allowed: false, reason: 'not on this project', twoFactorVerifiedAt: verifiedAt };
  },
});

/** Writing a sealed item. Called only by the Node action that sealed it; the plaintext never reaches this file. */
export const insertSealed = internalMutation({
  args: {
    clientId: v.id('clients'),
    projectId: v.optional(v.id('projects')),
    label: v.string(),
    kind,
    url: v.optional(v.string()),
    usernameCiphertext: v.optional(v.string()),
    secretCiphertext: v.string(),
    notesCiphertext: v.optional(v.string()),
    iv: v.string(),
    keyVersion: v.number(),
    rotateByDate: v.optional(v.string()),
    submittedByKind: v.union(v.literal('team'), v.literal('client'), v.literal('system')),
    submittedById: v.string(),
  },
  handler: async (ctx, args): Promise<Id<'vaultItems'>> => {
    await getClient(ctx, args.clientId);
    if (args.projectId) {
      const project = await ctx.db.get('projects', args.projectId);
      if (!project || project.clientId !== args.clientId) {
        throw vaultError('vault.invalid', 'That project does not belong to this client');
      }
    }
    const itemId = await ctx.db.insert('vaultItems', {
      ...args,
      label: text(args.label, 'Label', { required: true, max: 120 })!,
      url: text(args.url, 'URL', { max: 500 }),
      status: 'active',
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: args.clientId },
      clientId: args.clientId,
      type: 'system',
      // The label, never the secret: an activity entry is read by more people than the item is.
      title: `${args.label} added to the vault`,
      actor:
        args.submittedByKind === 'team'
          ? { kind: 'team', id: args.submittedById }
          : args.submittedByKind === 'client'
            ? { kind: 'client', id: args.submittedById }
            : { kind: 'system' },
      meta: { vaultItemId: itemId },
    });
    return itemId;
  },
});

/**
 * Every reveal, copy and refusal, written whether or not the secret was handed over.
 *
 * A reveal and a copy also append to the audit log, which the spec asks for separately and for a different reader: the
 * access log answers "who has seen this credential", and the audit log answers "what did this person do today". A
 * refusal is not in the audit log, which records what happened to records; nothing happened, and the access log is
 * where an attempt belongs. The entry is a `read` of the item and carries no diff, so it cannot carry a value.
 */
export const logAccess = internalMutation({
  args: {
    vaultItemId: v.id('vaultItems'),
    clientId: v.id('clients'),
    memberId: v.optional(v.id('teamMembers')),
    action: v.union(v.literal('reveal'), v.literal('copy'), v.literal('refused')),
    reason: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const at = Date.now();
    const { authUserId, ...logFields } = args;
    await ctx.db.insert('vaultAccessLogs', { ...logFields, at });
    // Only a reveal that actually happened counts as the item having been seen.
    if (args.action === 'reveal') await ctx.db.patch('vaultItems', args.vaultItemId, { lastRevealedAt: at });
    if (args.action === 'reveal' || args.action === 'copy') {
      await appendAuditEntry(
        ctx.db,
        {
          actorKind: 'team',
          actorId: args.memberId,
          authUserId,
          permission: args.action === 'reveal' ? 'vault.reveal' : 'vault.copy',
          ip: args.ipAddress,
        },
        { action: 'read', table: 'vaultItems', recordId: args.vaultItemId },
      );
    }
    return null;
  },
});

/** Recorded when a member enters their code again mid-session, which opens the window for a reveal. */
export const recordTwoFactorCheck = internalMutation({
  args: { sessionId: v.string(), memberId: v.id('teamMembers') },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.insert('twoFactorChecks', { ...args, verifiedAt: Date.now() });
    return null;
  },
});
