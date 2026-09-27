'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { open, seal } from './lib/crypto';
import { portalAction, teamAction } from './lib/functions';
import { TWO_FACTOR_WINDOW_MS, REVEAL_VISIBLE_MS, vaultError } from './lib/vault';

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
    const principal = ctx.principal;
    if (args.secret.trim().length === 0) throw vaultError('vault.invalid', 'There is no secret here to keep');
    // A field at a time: each gets its own random IV and its own authentication tag, as the spec requires.
    const sealedSecret = seal(args.secret);
    const username = args.username?.trim() ? seal(args.username, sealedSecret.keyVersion) : undefined;
    const notes = args.notes?.trim() ? seal(args.notes, sealedSecret.keyVersion) : undefined;

    return await ctx.runMutation(internal.vaultData.insertSealed, {
      clientId: args.clientId,
      projectId: args.projectId,
      label: args.label,
      kind: args.kind,
      url: args.url,
      usernameCiphertext: username?.ciphertext,
      secretCiphertext: sealedSecret.ciphertext,
      notesCiphertext: notes?.ciphertext,
      // Each sealed field kept its own IV; they are stored joined so one row can carry them all.
      iv: [sealedSecret.iv, username?.iv ?? '', notes?.iv ?? ''].join('.'),
      keyVersion: sealedSecret.keyVersion,
      rotateByDate: args.rotateByDate,
      submittedByKind: 'team',
      submittedById: principal.memberId,
    });
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
    const sealedSecret = seal(args.secret);
    const username = args.username?.trim() ? seal(args.username, sealedSecret.keyVersion) : undefined;
    const notes = args.notes?.trim() ? seal(args.notes, sealedSecret.keyVersion) : undefined;
    return await ctx.runMutation(internal.vaultData.insertSealed, {
      clientId: ctx.principal.clientId,
      projectId: args.projectId,
      label: args.label,
      kind: args.kind,
      url: args.url,
      usernameCiphertext: username?.ciphertext,
      secretCiphertext: sealedSecret.ciphertext,
      notesCiphertext: notes?.ciphertext,
      iv: [sealedSecret.iv, username?.iv ?? '', notes?.iv ?? ''].join('.'),
      keyVersion: sealedSecret.keyVersion,
      submittedByKind: 'client',
      submittedById: ctx.principal.contactId,
    });
  },
});
