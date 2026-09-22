import { ConvexError } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { type ActionCtx } from './_generated/server';
import { isAllowedOrigin } from './lib/enquiries';
import { signedDownloadUrl } from './lib/files';
import { publicHttp } from './lib/functions';
import { allowedHosts, originOf } from './lib/hosts';
import { sendSignatureEmail } from './lib/signatureEmails';

// The public signing endpoints behind /sign/[token] (07-documents-and-esign.md, The signing ceremony). The page posts
// the token in the body, never the URL, so it stays out of request logs. Only the app's own hosts may call them, and
// the rules (the code, its limits, the order of signers) live in the internal mutations in convex/signatures.ts.
//
//   POST /public/sign/view      { token }                      the document, while it is the signer's to sign
//   POST /public/sign/code      { token }                      email a fresh code
//   POST /public/sign/verify    { token, code }                check it
//   POST /public/sign/upload    { token }                      an upload URL for a drawn signature, once verified
//   POST /public/sign/sign      { token, method, typedName?, imageStorageId?, consent }
//   POST /public/sign/decline   { token, reason }

const MAX_BODY_BYTES = 8_000;

const token = z.string().min(20).max(100);
const schemas = {
  view: z.object({ token }),
  code: z.object({ token }),
  verify: z.object({ token, code: z.string().regex(/^\s*\d{6}\s*$/) }),
  upload: z.object({ token }),
  sign: z.object({
    token,
    method: z.enum(['typed', 'drawn']),
    typedName: z.string().max(200).optional(),
    imageStorageId: z.string().max(100).optional(),
    consent: z.boolean(),
  }),
  decline: z.object({ token, reason: z.string().min(1).max(2000) }),
};
type Step = keyof typeof schemas;

/** The app's own origins: the team app and the portal, from the hosts this deployment serves. */
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

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('cf-connecting-ip') ?? forwarded ?? request.headers.get('x-real-ip') ?? 'unknown';
}

type From = { ip: string; userAgent?: string };
// Declared rather than inferred: an inferred type would run through convex/_generated/api.d.ts, which lists this
// module, and the cycle widens every api.* type in the app.
type Endpoint = ReturnType<typeof publicHttp>;

const STATUS_FOR: Record<string, number> = {
  'signatures.notFound': 404,
  'signatures.rateLimited': 429,
};

export const preflight: Endpoint = publicHttp(async (_ctx, request) => {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin, appOrigins())) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin!) });
});

function endpoint<S extends Step>(
  step: S,
  run: (ctx: ActionCtx, body: z.infer<(typeof schemas)[S]>, from: From) => Promise<object>,
) {
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
    if (!parsed.success) return json({ ok: false, code: 'invalid', message: 'Check what you entered' }, 400, cors);

    const from = { ip: clientIp(request), userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? undefined };
    try {
      return json({ ok: true, ...(await run(ctx, parsed.data as z.infer<(typeof schemas)[S]>, from)) }, 200, cors);
    } catch (error) {
      // The rules' own refusals carry a message meant for the signer; anything else is not described.
      if (error instanceof ConvexError && typeof error.data === 'object' && error.data?.code) {
        const { code, message } = error.data as { code: string; message: string };
        return json({ ok: false, code, message }, STATUS_FOR[code] ?? 400, cors);
      }
      throw error;
    }
  });
}

export const view: Endpoint = endpoint('view', async (ctx, { token }, from) => {
  const page = await ctx.runQuery(internal.signatures.viewByToken, { token });
  if (!page.document) return { page };
  await ctx.runMutation(internal.signatures.markViewed, { token, ...from });
  const { pdfFileId, ...document } = page.document;
  // The PDF comes through the usual signed, short-lived download link.
  const pdfUrl = pdfFileId ? (await signedDownloadUrl(pdfFileId, Date.now())).url : undefined;
  return { page: { ...page, document: { ...document, pdfUrl } } };
});

export const code: Endpoint = endpoint('code', async (ctx, { token }, from) => {
  const issued = await ctx.runMutation(internal.signatures.issueCode, { token, ip: from.ip });
  await sendSignatureEmail({
    kind: 'code',
    to: issued.email,
    code: issued.code,
    documentNumber: issued.documentNumber,
  });
  // Where it went, partly hidden, so the signer knows which inbox to check.
  return { sentTo: issued.email.replace(/^(.)[^@]*(@.*)$/, '$1…$2') };
});

export const verify: Endpoint = endpoint('verify', async (ctx, { token, code }, from) => {
  return await ctx.runMutation(internal.signatures.verifyCode, { token, code, ...from });
});

export const upload: Endpoint = endpoint('upload', async (ctx, { token }) => {
  await ctx.runQuery(internal.signatures.assertReadyToSign, { token });
  return { uploadUrl: await ctx.storage.generateUploadUrl() };
});

export const sign: Endpoint = endpoint('sign', async (ctx, body, from) => {
  const result = await ctx.runMutation(internal.signatures.signByToken, {
    token: body.token,
    method: body.method,
    typedName: body.typedName,
    imageStorageId: body.imageStorageId,
    consent: body.consent,
    ...from,
  });
  if (!result.ok) throw new ConvexError({ code: 'signatures.invalid', message: result.message });
  return {};
});

export const decline: Endpoint = endpoint('decline', async (ctx, { token, reason }, from) => {
  await ctx.runMutation(internal.signatures.declineByToken, { token, reason, ...from });
  return {};
});
