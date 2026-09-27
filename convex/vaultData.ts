import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { appendAuditEntry } from './lib/audit';
import { DEFAULT_BUSINESS_CALENDAR, localDateString } from './lib/businessTime';
import { getClient, recordActivity, requirePermission, text } from './lib/crm';
import { internalMutation, internalQuery, portalQuery, teamMutation, teamQuery } from './lib/functions';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { type TeamPrincipal } from './lib/principals';
import {
  canSeeItem,
  itemsForClient,
  itemView,
  memberMaySeeItem,
  portalItemView,
  twoFactorVerifiedAt,
  vaultError,
} from './lib/vault';

type Principal = { principal: TeamPrincipal };

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

/**
 * The item, if this member may see it at all. `vault.manage` is permission to edit the vault, not permission to see
 * more of it, so scope is checked the same way a reveal checks it and a refusal says the same thing a missing item
 * says. Anything else would let somebody off the project learn which credentials exist by trying to edit them.
 */
async function visibleItem(ctx: MutationCtx & Principal, itemId: Id<'vaultItems'>): Promise<Doc<'vaultItems'>> {
  const item = await ctx.db.get('vaultItems', itemId);
  if (!item || !(await canSeeItem(ctx, ctx.principal, item)))
    throw vaultError('vault.notFound', 'That item is not here');
  return item;
}

/** As above, and refusing an archived item: an archive is a record of what was, so only its status may still change. */
async function editableItem(ctx: MutationCtx & Principal, itemId: Id<'vaultItems'>): Promise<Doc<'vaultItems'>> {
  const item = await visibleItem(ctx, itemId);
  if (item.status === 'archived') throw vaultError('vault.archived', 'Restore this item before editing it');
  return item;
}

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

/**
 * Everything about an item except the secret. `vault.manage` says who may edit, but it does not widen what they can
 * see: an item they could not reveal is an item they cannot edit either, and it answers "not here" rather than
 * admitting it exists. Changing the secret itself is convex/vault.ts `updateSecret`, which needs a key.
 */
export const update = teamMutation('vault.manage')({
  args: {
    itemId: v.id('vaultItems'),
    label: v.optional(v.string()),
    kind: v.optional(kind),
    url: v.optional(v.string()),
    projectId: v.optional(v.union(v.id('projects'), v.null())),
    rotateByDate: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { itemId, ...changes }): Promise<null> => {
    const item = await editableItem(ctx, itemId);
    // A project the item is moved to has to belong to the same client, exactly as on the way in.
    if (changes.projectId) {
      const project = await ctx.db.get('projects', changes.projectId);
      if (!project || project.clientId !== item.clientId) {
        throw vaultError('vault.invalid', 'That project does not belong to this client');
      }
    }
    await ctx.db.patch('vaultItems', itemId, {
      ...(changes.label !== undefined ? { label: text(changes.label, 'Label', { required: true, max: 120 })! } : {}),
      ...(changes.kind !== undefined ? { kind: changes.kind } : {}),
      ...(changes.url !== undefined ? { url: text(changes.url, 'URL', { max: 500 }) } : {}),
      // Null is how a screen says "off this project" and "no rotation date"; undefined means "leave it alone".
      ...(changes.projectId !== undefined ? { projectId: changes.projectId ?? undefined } : {}),
      ...(changes.rotateByDate !== undefined
        ? { rotateByDate: changes.rotateByDate ?? undefined, rotationRemindedOn: undefined }
        : {}),
    });
    return null;
  },
});

/**
 * Handover and archiving (10-vault.md, Lifecycle). Handed over means the client holds this now and the studio's copy is
 * history; archived takes it out of every list and starts the retention clock. Archiving is not deleting: the ciphertext
 * stays until the retention step removes it, so an item archived by mistake can come back.
 */
export const setStatus = teamMutation('vault.manage')({
  args: {
    itemId: v.id('vaultItems'),
    status: v.union(v.literal('active'), v.literal('handed_over'), v.literal('archived')),
  },
  handler: async (ctx, { itemId, status }): Promise<null> => {
    // Archived items are editable here and nowhere else: this is the one route back out of the archive.
    const item = await visibleItem(ctx, itemId);
    if (item.status === status) return null;
    await ctx.db.patch('vaultItems', itemId, {
      status,
      archivedAt: status === 'archived' ? Date.now() : undefined,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: item.clientId },
      clientId: item.clientId,
      type: 'system',
      title:
        status === 'handed_over'
          ? `${item.label} handed over to the client`
          : status === 'archived'
            ? `${item.label} archived in the vault`
            : `${item.label} restored in the vault`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { vaultItemId: itemId },
    });
    return null;
  },
});

/**
 * Deleting an item removes the ciphertext, which is the only copy of the secret. The access log is kept: it is the
 * record of who saw this credential while it existed, and deleting the item is not a reason to lose that.
 */
export const remove = teamMutation('vault.manage')({
  args: { itemId: v.id('vaultItems') },
  handler: async (ctx, { itemId }): Promise<null> => {
    const item = await visibleItem(ctx, itemId);
    await ctx.db.delete('vaultItems', itemId);
    await recordActivity(ctx, {
      subject: { table: 'clients', id: item.clientId },
      clientId: item.clientId,
      type: 'system',
      title: `${item.label} deleted from the vault`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { vaultItemId: itemId },
    });
    return null;
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
    const check = await ctx.db
      .query('twoFactorChecks')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .order('desc')
      .first();
    return { ...(await memberMaySeeItem(ctx, memberId, item)), twoFactorVerifiedAt: check?.verifiedAt ?? 0 };
  },
});

/**
 * Replacing the sealed fields on an item, after convex/vault.ts sealed them. Scope is re-checked here from the member
 * id, because an action has no principal to hand on, and it uses the same rule a reveal uses.
 */
export const replaceSealed = internalMutation({
  args: {
    itemId: v.id('vaultItems'),
    memberId: v.id('teamMembers'),
    usernameCiphertext: v.optional(v.string()),
    secretCiphertext: v.string(),
    notesCiphertext: v.optional(v.string()),
    iv: v.string(),
    keyVersion: v.number(),
  },
  handler: async (ctx, { itemId, memberId, ...sealed }): Promise<null> => {
    const item = await ctx.db.get('vaultItems', itemId);
    if (!item) throw vaultError('vault.notFound', 'That item is not here');
    if (!(await memberMaySeeItem(ctx, memberId, item)).allowed) {
      throw vaultError('vault.notFound', 'That item is not here');
    }
    if (item.status === 'archived') throw vaultError('vault.archived', 'Restore this item before editing it');
    await ctx.db.patch('vaultItems', itemId, {
      ...sealed,
      // A rotation satisfies the reminder, and the next date is set deliberately rather than guessed at.
      rotateByDate: undefined,
      rotationRemindedOn: undefined,
      lastRotatedAt: Date.now(),
      lastRotatedByMemberId: memberId,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: item.clientId },
      clientId: item.clientId,
      type: 'system',
      title: `${item.label} rotated in the vault`,
      actor: { kind: 'team', id: memberId },
      meta: { vaultItemId: itemId },
    });
    return null;
  },
});

/**
 * Rotation reminders (10-vault.md, Lifecycle): seven days before the date, and on the date.
 *
 * Which milestone was last sent is remembered as its own date, not as a flag, so a day the cron did not run is caught
 * up rather than skipped — a reminder about a credential going stale is not worth losing to a deployment window. Both
 * milestones can be due at once for a date set inside the window; only the nearer one is sent, because two
 * notifications about the same credential on the same day is how people learn to ignore them.
 */
export const sendRotationReminders = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const today = localDateString(Date.now(), DEFAULT_BUSINESS_CALENDAR.timezone);
    const due = await ctx.db
      .query('vaultItems')
      .withIndex('by_status_rotate', (q) => q.eq('status', 'active').lte('rotateByDate', addDays(today, 7)))
      .collect();

    let sent = 0;
    for (const item of due) {
      if (!item.rotateByDate) continue;
      // The nearer milestone that has arrived: the date itself once it is here, otherwise the warning.
      const milestone = today >= item.rotateByDate ? item.rotateByDate : addDays(item.rotateByDate, -7);
      if (today < milestone || item.rotationRemindedOn === milestone) continue;

      const recipients = await rotationRecipients(ctx, item);
      if (recipients.length === 0) continue;
      const onTheDay = milestone === item.rotateByDate;
      await notifyTeamMembers(ctx, recipients, {
        event: 'vault.rotation.due',
        title: onTheDay ? `${item.label} is due to be rotated` : `${item.label} needs rotating in 7 days`,
        body: onTheDay
          ? `${item.label} was due to be changed on ${item.rotateByDate}. Change it where the credential lives, then update the vault.`
          : `${item.label} is due to be changed on ${item.rotateByDate}.`,
        link: `/crm/clients/${item.clientId}/vault`,
      });
      await ctx.db.patch('vaultItems', item._id, { rotationRemindedOn: milestone });
      sent++;
    }
    return { sent };
  },
});

/**
 * Who hears about a credential going stale. The spec names the project manager; an item held against the client as a
 * whole has none, so it goes to the client's owner, and to everyone who can see the whole vault if the client has no
 * owner either. A reminder nobody receives is the one failure this must not have.
 */
async function rotationRecipients(ctx: MutationCtx, item: Doc<'vaultItems'>): Promise<Id<'teamMembers'>[]> {
  if (item.projectId) {
    const project = await ctx.db.get('projects', item.projectId);
    if (project) return [project.managerMemberId];
  }
  const client = await ctx.db.get('clients', item.clientId);
  if (client?.ownerMemberId) return [client.ownerMemberId];
  return await activeMembersWith(ctx, 'vault.view.all');
}

/** A YYYY-MM-DD shifted by whole days, which is all the rotation dates need: they are dates, not instants. */
function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

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

// Key rotation ------------------------------------------------------------------------------------------------------

/** Starts a run, or returns the one already going: two rotations at once would fight over the same rows. */
export const beginKeyRotation = internalMutation({
  args: { toKeyVersion: v.number(), startedByMemberId: v.optional(v.id('teamMembers')) },
  handler: async (ctx, args): Promise<Id<'vaultKeyRotations'>> => {
    const running = await ctx.db
      .query('vaultKeyRotations')
      .withIndex('by_status', (q) => q.eq('status', 'running'))
      .first();
    if (running) return running._id;
    return await ctx.db.insert('vaultKeyRotations', {
      ...args,
      status: 'running',
      processed: 0,
      skipped: 0,
      failed: 0,
      startedAt: Date.now(),
    });
  },
});

/** One batch of items to re-encrypt, and where the next batch starts. Archived items are included: they still decrypt. */
export const itemsToReencrypt = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.number() },
  handler: async (
    ctx,
    { cursor, batchSize },
  ): Promise<{ items: Doc<'vaultItems'>[]; cursor: string | null; isDone: boolean }> => {
    const page = await ctx.db.query('vaultItems').paginate({ cursor, numItems: batchSize });
    return { items: page.page, cursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * Stores one item's fields under the new key. Written as its own mutation per item so a failure costs one item rather
 * than a batch, and so the row is never half-rotated: all three fields and the version move together.
 */
export const applyReencrypted = internalMutation({
  args: {
    itemId: v.id('vaultItems'),
    usernameCiphertext: v.optional(v.string()),
    secretCiphertext: v.string(),
    notesCiphertext: v.optional(v.string()),
    iv: v.string(),
    keyVersion: v.number(),
  },
  handler: async (ctx, { itemId, ...sealed }): Promise<null> => {
    const item = await ctx.db.get('vaultItems', itemId);
    if (!item) return null;
    // Re-encrypting is not a rotation of the secret: the value is the same one, so lastRotatedAt is left alone.
    await ctx.db.patch('vaultItems', itemId, sealed);
    return null;
  },
});

/** Progress after a batch, and the finishing touch when the last one is in. */
export const recordRotationProgress = internalMutation({
  args: {
    rotationId: v.id('vaultKeyRotations'),
    processed: v.number(),
    skipped: v.number(),
    failed: v.number(),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  },
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get('vaultKeyRotations', args.rotationId);
    if (!run) return null;
    await ctx.db.patch('vaultKeyRotations', args.rotationId, {
      processed: run.processed + args.processed,
      skipped: run.skipped + args.skipped,
      failed: run.failed + args.failed,
      cursor: args.cursor,
      ...(args.isDone ? { status: 'done' as const, finishedAt: Date.now() } : {}),
    });
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
