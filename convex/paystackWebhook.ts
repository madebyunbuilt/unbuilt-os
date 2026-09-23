import { internal } from './_generated/api';
import { publicHttp } from './lib/functions';
import { sameSignature, signatureFor } from './lib/paystack';

// POST /webhooks/paystack (14-platform.md, Webhooks): verify the signature before parsing, store the event once, then
// hand it to an action and answer quickly. Paystack retries anything that is not answered 200.

export const paystackWebhook = publicHttp(async (ctx, request) => {
  const raw = await request.text();
  const signature = request.headers.get('x-paystack-signature');
  if (!signature || !sameSignature(signature, await signatureFor(raw))) {
    return new Response('Bad signature', { status: 401 });
  }

  let event: { event?: string; id?: string | number; data?: { id?: number; reference?: string } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return new Response('Bad body', { status: 400 });
  }
  const type = event.event ?? 'unknown';
  // Paystack does not always send an event id; the transaction and type identify it just as well.
  const eventId = String(event.id ?? `${type}:${event.data?.id ?? event.data?.reference ?? raw.length}`);

  const stored = await ctx.runMutation(internal.paystack.recordEvent, { eventId, type, payload: raw });
  // Already seen: answer 200 so Paystack stops retrying, and do nothing again.
  if (stored) await ctx.scheduler.runAfter(0, internal.paystack.processEvent, { eventId: stored, type, payload: raw });
  return new Response('ok', { status: 200 });
});
