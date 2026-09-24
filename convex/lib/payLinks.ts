import { internal } from '../_generated/api';
import { type Id } from '../_generated/dataModel';
import { type ActionCtx } from '../_generated/server';
import { portalAppOrigin } from './hosts';
import { sha256Hex } from './signatures';

// The pay link an invoice email carries (08-billing-and-finance.md, Paystack). One link per invoice, the same in every
// email it appears in: the first send, every reminder and every resend. A client sitting on an older email can still
// pay from it, which is the whole point of sending them a link at all.
//
// The token is derived from a server secret and the invoice's id rather than drawn at random, so any send can work out
// the same link without the plaintext ever being stored: only its hash is kept, for the lookup in invoices.byPayToken.
// Rotating PAY_LINK_SECRET therefore replaces every pay link that has gone out; links already sent stop working.

const DERIVATION = 'pay-link.v1';

function payLinkSecret(): string {
  const secret = process.env.PAY_LINK_SECRET;
  if (!secret || secret.length < 32) throw new Error('PAY_LINK_SECRET must be set to at least 32 characters');
  return secret;
}

export async function deriveToken(invoiceId: Id<'invoices'>): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(payLinkSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${DERIVATION}.${invoiceId}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The invoice's pay link, or nothing when this deployment cannot make one. A missing portal address or secret leaves
 * the email without a Pay button rather than stopping it: the invoice and its bank details still need to go out.
 */
export async function mintPayLink(ctx: ActionCtx, invoiceId: Id<'invoices'>): Promise<string | undefined> {
  const origin = portalAppOrigin();
  if (!origin || !process.env.PAY_LINK_SECRET) return undefined;
  const token = await deriveToken(invoiceId);
  // Written every time: an invoice sent before this was derived still holds the hash of its old random token.
  await ctx.runMutation(internal.invoices.setPayToken, { invoiceId, tokenHash: await sha256Hex(token) });
  return `${origin}/pay/${token}`;
}
