import { ConvexError } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { type ActionCtx } from './_generated/server';
import { isAllowedOrigin } from './lib/enquiries';
import { publicHttp } from './lib/functions';
import { allowedHosts, originOf } from './lib/hosts';

// The public pay page behind /pay/[token] (08-billing-and-finance.md, Paystack). The token is posted in the body, never
// the URL, so it stays out of request logs. Opening the page never changes anything; pressing Pay creates a Paystack
// transaction for exactly what is owed at that moment (or what is owed less the withholding tax the client keeps back),
// and only a verified webhook ever records the payment.
//
//   POST /public/pay/view   { token }
//   POST /public/pay/start  { token, withholdWht }

const MAX_BODY_BYTES = 2_000;
const token = z.string().min(20).max(100);
const schemas = {
  view: z.object({ token }),
  start: z.object({ token, withholdWht: z.boolean().optional() }),
};
type Step = keyof typeof schemas;

const appOrigins = () => allowedHosts().map(originOf);

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

const json = (body: object, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('cf-connecting-ip') ?? forwarded ?? request.headers.get('x-real-ip') ?? 'unknown';
}

type Endpoint = ReturnType<typeof publicHttp>;

function endpoint<S extends Step>(
  step: S,
  run: (ctx: ActionCtx, body: z.infer<(typeof schemas)[S]>, ip: string) => Promise<object>,
): Endpoint {
  return publicHttp(async (ctx, request) => {
    const origin = request.headers.get('origin');
    if (!isAllowedOrigin(origin, appOrigins())) return new Response(null, { status: 403 });
    const cors = corsHeaders(origin!);
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, code: 'invalid' }, 413, cors);
    let parsed;
    try {
      parsed = schemas[step].safeParse(JSON.parse(raw));
    } catch {
      return json({ ok: false, code: 'invalid' }, 400, cors);
    }
    if (!parsed.success) return json({ ok: false, code: 'invalid', message: 'Check the link' }, 400, cors);
    try {
      const answer = await run(ctx, parsed.data as z.infer<(typeof schemas)[S]>, clientIp(request));
      return json({ ok: true, ...answer }, 200, cors);
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === 'object' && error.data?.code) {
        const { code, message } = error.data as { code: string; message: string };
        return json({ ok: false, code, message }, code === 'invoices.notFound' ? 404 : 400, cors);
      }
      throw error;
    }
  });
}

export const preflight: Endpoint = publicHttp(async (_ctx, request) => {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin, appOrigins())) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin!) });
});

export const view: Endpoint = endpoint('view', async (ctx, { token }) => ({
  invoice: await ctx.runQuery(internal.invoices.byPayToken, { token }),
}));

export const start: Endpoint = endpoint('start', async (ctx, { token, withholdWht }, ip) => {
  return await ctx.runAction(internal.paystack.startCheckout, { token, withholdWht: withholdWht ?? false, ip });
});
