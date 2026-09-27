'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { open, seal } from './lib/crypto';
import { portalAction, teamAction } from './lib/functions';
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
