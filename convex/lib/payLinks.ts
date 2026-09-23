import { internal } from '../_generated/api';
import { type Id } from '../_generated/dataModel';
import { type ActionCtx } from '../_generated/server';
import { portalAppOrigin } from './hosts';
import { newToken, sha256Hex } from './signatures';

// The pay link an invoice email carries (08-billing-and-finance.md, Paystack). Only the token's hash is stored, so each
// email carries a freshly minted link and the ones before it stop working, exactly as signing links do.

export async function mintPayLink(ctx: ActionCtx, invoiceId: Id<'invoices'>): Promise<string | undefined> {
  const origin = portalAppOrigin();
  if (!origin) return undefined;
  const token = newToken();
  await ctx.runMutation(internal.invoices.setPayToken, { invoiceId, tokenHash: await sha256Hex(token) });
  return `${origin}/pay/${token}`;
}
