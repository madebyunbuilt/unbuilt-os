import { isLocalHost } from '@/convex/lib/hosts';

// Next.js normalises a route handler's `request.url` to the server's own address, so on portal.localhost:3000 it still
// reads localhost:3000. The Better Auth adapter derives x-forwarded-host from that URL, which sent portal sign-ins back
// to the team app. Putting the host the browser actually used back into the URL keeps the whole flow on one host.

/** The host the browser asked for: what a proxy forwarded, else the Host header. */
export function requestedHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('host')?.trim() || null;
}

/** The same request with its URL on the host the browser used. Returns it untouched when they already agree. */
export function onRequestedHost(request: Request): Request {
  const host = requestedHost(request);
  if (!host) return request;
  const url = new URL(request.url);
  if (url.host === host) return request;

  // Built as a string: assigning `host` alone would keep the old port when the new host names none.
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? (isLocalHost(host) ? 'http' : 'https');
  const moved = new URL(`${proto}://${host}${url.pathname}${url.search}${url.hash}`);
  // A streamed body needs half duplex; GET and HEAD carry none.
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
    signal: request.signal,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }
  return new Request(moved, init);
}
