'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { activeKeyVersion, open, seal } from './lib/crypto';
import { internalAction, portalAction, teamAction } from './lib/functions';
import { REVEAL_VISIBLE_MS, type SealedFields, TWO_FACTOR_WINDOW_MS, vaultError } from './lib/vault';

// The only place a vault key is ever touched (10-vault.md, Storage). Everything else in the codebase handles
// ciphertext it cannot read. A secret exists in plaintext here for the length of one action and is returned to the
// person who asked; it is never written to a document, a log, a notification or an audit diff.

const kind = v.union(
  v.literal('login'),
  v.literal('api_key'),
  v.literal('ssh_key'),
  v.literal('env_file'),
  v.literal('note'),
);

/**
 * Seals the three fields that carry anything private, under one key version. Each gets its own random IV and its own
 * authentication tag, as the spec requires; the IVs are stored joined in one field, positionally, so a row can carry
 * all three. An empty username or note is left unsealed rather than sealed as an empty string, so `hasUsername` on a
 * listing means what it says.
 */
function sealFields(fields: { secret: string; username?: string; notes?: string }): SealedFields {
  const secret = seal(fields.secret);
  const username = fields.username?.trim() ? seal(fields.username, secret.keyVersion) : undefined;
  const notes = fields.notes?.trim() ? seal(fields.notes, secret.keyVersion) : undefined;
  return {
    usernameCiphertext: username?.ciphertext,
    secretCiphertext: secret.ciphertext,
    notesCiphertext: notes?.ciphertext,
    iv: [secret.iv, username?.iv ?? '', notes?.iv ?? ''].join('.'),
    keyVersion: secret.keyVersion,
  };
}

/** Adding an item. It is sealed before the mutation that stores it is even called. */
export const create = teamAction('vault.manage')({
  args: {
    clientId: v.id('clients'),
    projectId: v.optional(v.id('projects')),
    label: v.string(),
    kind,
    url: v.optional(v.string()),
    username: v.optional(v.string()),
    secret: v.string(),
    notes: v.optional(v.string()),
    rotateByDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'vaultItems'>> => {
    if (args.secret.trim().length === 0) throw vaultError('vault.invalid', 'There is no secret here to keep');
    return await ctx.runMutation(internal.vaultData.insertSealed, {
      clientId: args.clientId,
      projectId: args.projectId,
      label: args.label,
      kind: args.kind,
      url: args.url,
      ...sealFields(args),
      rotateByDate: args.rotateByDate,
      submittedByKind: 'team',
      submittedById: ctx.principal.memberId,
    });
  },
});

/**
 * Changing the secret on an item that already exists — the ordinary end of a rotation, once the credential has been
 * changed wherever it actually lives. The old ciphertext is replaced rather than kept beside the new one: a vault that
 * held every previous password would be a worse thing to lose than one that holds the current one. Whoever rotated it
 * is recorded, and the access log keeps who had seen the old value.
 */
export const updateSecret = teamAction('vault.manage')({
  args: {
    itemId: v.id('vaultItems'),
    secret: v.string(),
    username: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    if (args.secret.trim().length === 0) throw vaultError('vault.invalid', 'There is no secret here to keep');
    await ctx.runMutation(internal.vaultData.replaceSealed, {
      itemId: args.itemId,
      memberId: ctx.principal.memberId,
      ...sealFields(args),
    });
    return null;
  },
});

/**
 * Showing a secret to somebody entitled to see it (10-vault.md, Access). Every path through this writes an access
 * log — including every refusal, because an attempt to read a credential is exactly the thing worth knowing about.
 */
export const reveal = teamAction(null)({
  args: { itemId: v.id('vaultItems') },
  handler: async (
    ctx,
    { itemId },
  ): Promise<{ username?: string; secret: string; notes?: string; hideAfterMs: number }> => {
    const principal = ctx.principal;
    const item = await ctx.runQuery(internal.vaultData.forReveal, { itemId });
    // An item nobody may see is not there, and there is nothing to log against.
    if (!item) throw vaultError('vault.notFound', 'That item is not here');

    const refuse = async (reason: string, code: `vault.${string}`, message: string): Promise<never> => {
      await ctx.runMutation(internal.vaultData.logAccess, {
        vaultItemId: itemId,
        clientId: item.clientId,
        memberId: principal.memberId,
        action: 'refused',
        reason,
        ipAddress: principal.ip,
        authUserId: principal.authUserId,
      });
      throw vaultError(code, message);
    };

    const seen = await ctx.runQuery(internal.vaultData.mayReveal, {
      itemId,
      memberId: principal.memberId,
      sessionId: principal.sessionId,
    });
    if (!seen.allowed) await refuse(seen.reason, 'vault.notFound', 'That item is not here');
    // Either the session began with a second factor recently enough, or the member has entered a code again since.
    const verifiedAt = Math.max(seen.twoFactorVerifiedAt, principal.signedInAt);
    if (verifiedAt < Date.now() - TWO_FACTOR_WINDOW_MS) {
      await refuse(
        'second factor too old',
        'vault.twoFactorRequired',
        'Enter your authenticator code again before revealing this',
      );
    }

    const [secretIv, usernameIv, notesIv] = item.iv.split('.');
    const value = {
      username:
        item.usernameCiphertext && usernameIv
          ? open({ ciphertext: item.usernameCiphertext, iv: usernameIv, keyVersion: item.keyVersion })
          : undefined,
      secret: open({ ciphertext: item.secretCiphertext, iv: secretIv, keyVersion: item.keyVersion }),
      notes:
        item.notesCiphertext && notesIv
          ? open({ ciphertext: item.notesCiphertext, iv: notesIv, keyVersion: item.keyVersion })
          : undefined,
      hideAfterMs: REVEAL_VISIBLE_MS,
    };

    await ctx.runMutation(internal.vaultData.logAccess, {
      vaultItemId: itemId,
      clientId: item.clientId,
      memberId: principal.memberId,
      action: 'reveal',
      ipAddress: principal.ip,
      authUserId: principal.authUserId,
    });
    return value;
  },
});

/**
 * Copying a revealed secret to the clipboard, which the spec logs as its own kind of access: a value on screen for
 * thirty seconds and a value in a clipboard are different amounts of exposure.
 */
export const recordCopy = teamAction(null)({
  args: { itemId: v.id('vaultItems') },
  handler: async (ctx, { itemId }): Promise<null> => {
    const principal = ctx.principal;
    const item = await ctx.runQuery(internal.vaultData.forReveal, { itemId });
    if (!item) throw vaultError('vault.notFound', 'That item is not here');
    await ctx.runMutation(internal.vaultData.logAccess, {
      vaultItemId: itemId,
      clientId: item.clientId,
      memberId: principal.memberId,
      action: 'copy',
      ipAddress: principal.ip,
      authUserId: principal.authUserId,
    });
    return null;
  },
});

/**
 * Key rotation (10-vault.md, Storage). Re-encrypts every item under the active key, a batch at a time, rescheduling
 * itself until it runs out of items. Resumable because the cursor lives in the run's row: an interrupted rotation is
 * restarted with the same `rotationId` and carries on from where it stopped, rather than starting over.
 *
 * An item that will not decrypt is counted and skipped, never deleted or blanked: the only copy of that secret is the
 * ciphertext, and a key that cannot read it is a reason to go and find the right key, not to destroy the value. The old
 * key must therefore stay set until `failed` is zero, which is why the count is kept on the run.
 */
export const rotateKeys = internalAction({
  args: {
    rotationId: v.optional(v.id('vaultKeyRotations')),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    startedByMemberId: v.optional(v.id('teamMembers')),
  },
  handler: async (ctx, args): Promise<{ rotationId: Id<'vaultKeyRotations'>; isDone: boolean }> => {
    const toKeyVersion = activeKeyVersion();
    const rotationId =
      args.rotationId ??
      (await ctx.runMutation(internal.vaultData.beginKeyRotation, {
        toKeyVersion,
        startedByMemberId: args.startedByMemberId,
      }));
    const batchSize = args.batchSize ?? 50;

    const page = await ctx.runQuery(internal.vaultData.itemsToReencrypt, {
      cursor: args.cursor ?? null,
      batchSize,
    });

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of page.items) {
      if (item.keyVersion === toKeyVersion) {
        skipped++;
        continue;
      }
      const [secretIv, usernameIv, notesIv] = item.iv.split('.');
      let plain: { secret: string; username?: string; notes?: string };
      try {
        plain = {
          secret: open({ ciphertext: item.secretCiphertext, iv: secretIv, keyVersion: item.keyVersion }),
          username:
            item.usernameCiphertext && usernameIv
              ? open({ ciphertext: item.usernameCiphertext, iv: usernameIv, keyVersion: item.keyVersion })
              : undefined,
          notes:
            item.notesCiphertext && notesIv
              ? open({ ciphertext: item.notesCiphertext, iv: notesIv, keyVersion: item.keyVersion })
              : undefined,
        };
      } catch {
        // Nothing about the value goes into the count, and nothing is logged: a failure here is about a key, not a secret.
        failed++;
        continue;
      }
      await ctx.runMutation(internal.vaultData.applyReencrypted, { itemId: item._id, ...sealFields(plain) });
      processed++;
    }

    await ctx.runMutation(internal.vaultData.recordRotationProgress, {
      rotationId,
      processed,
      skipped,
      failed,
      cursor: page.cursor,
      isDone: page.isDone,
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.vault.rotateKeys, { rotationId, cursor: page.cursor, batchSize });
    }
    return { rotationId, isDone: page.isDone };
  },
});

/**
 * A client handing a credential over (10-vault.md, Access). It is encrypted here, in the first thing that touches it,
 * so the plaintext never reaches a mutation. The client and the contact come from the session: there is no clientId
 * argument to point at somebody else's records, and `projectId` is checked against the client before the row is written.
 */
export const submitFromPortal = portalAction('portal.vault.submit')({
  args: {
    projectId: v.optional(v.id('projects')),
    label: v.string(),
    kind,
    url: v.optional(v.string()),
    username: v.optional(v.string()),
    secret: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'vaultItems'>> => {
    if (args.secret.trim().length === 0) throw vaultError('vault.invalid', 'There is no secret here to keep');
    return await ctx.runMutation(internal.vaultData.insertSealed, {
      clientId: ctx.principal.clientId,
      projectId: args.projectId,
      label: args.label,
      kind: args.kind,
      url: args.url,
      ...sealFields(args),
      submittedByKind: 'client',
      submittedById: ctx.principal.contactId,
    });
  },
});
