import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './lib/functions';
import { portalAppOrigin } from './lib/hosts';
import { assertCanSendEmail, sendSignatureEmail } from './lib/signatureEmails';
import { newToken, sha256Hex } from './lib/signatures';
import { failureReason } from './lib/failures';

// Emailing a signer their link (07-documents-and-esign.md, The signing ceremony). The token is minted here, inside the
// action, so the raw value only ever lives in memory and in the email: scheduler arguments are stored, and only the
// token's hash reaches the database. A new link replaces the signer's old one.

export const sendLink = internalAction({
  args: {
    requestId: v.id('signatureRequests'),
    signerId: v.string(),
    reason: v.union(v.literal('invitation'), v.literal('resend'), v.literal('reminder'), v.literal('final_reminder')),
  },
  handler: async (ctx, args): Promise<null> => {
    try {
      // Checked before the new link replaces the old one, so a deployment that cannot send leaves the signer's
      // current link working.
      const origin = portalAppOrigin();
      if (!origin) throw new Error('PORTAL_URL is not set on this deployment');
      assertCanSendEmail();
      const token = newToken();
      const link = await ctx.runMutation(internal.signatures.setLink, {
        requestId: args.requestId,
        signerId: args.signerId,
        tokenHash: await sha256Hex(token),
      });
      if (!link) return null;
      await sendSignatureEmail({
        kind: 'request',
        reason: args.reason,
        to: link.email,
        signerName: link.name,
        documentTitle: link.documentTitle,
        documentNumber: link.documentNumber,
        typeLabel: link.typeLabel,
        studioName: link.studioName,
        signingUrl: `${origin}/sign/${token}`,
        expiresAt: link.expiresAt,
      });
      return null;
    } catch (error) {
      await ctx.runMutation(internal.signatures.reportLinkFailed, {
        requestId: args.requestId,
        signerId: args.signerId,
        reason: failureReason(error, 'The signing link could not be sent'),
      });
      throw error;
    }
  },
});
