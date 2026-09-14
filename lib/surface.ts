// Hostname routing (docs/spec/02-architecture.md). Routing is a convenience, not a security boundary: every Convex
// function checks the caller itself.

export type Surface = 'team' | 'portal';

export const SURFACE_HEADER = 'x-unbuilt-surface';

const PORTAL_PREVIEW_HOST = /^unbuilt-os-portal-pr-\d+\.vercel\.app$/;

/** portal.unbuilt.studio, portal.localhost and portal previews are the portal; every other host is the team app. */
export function surfaceForHost(host: string | null | undefined): Surface {
  const hostname = (host ?? '').toLowerCase().split(':')[0];
  return hostname.startsWith('portal.') || PORTAL_PREVIEW_HOST.test(hostname) ? 'portal' : 'team';
}

/** Routes served identically on both hosts, without a session: sign-in, the auth API, signing and paying links. */
const SHARED_PUBLIC_PREFIXES = ['/api/auth', '/sign-in', '/sign', '/pay'];

const matchesPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isSharedPublicPath(pathname: string): boolean {
  return SHARED_PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

/** Portal pages live under app/portal and are reached only through the portal host. */
export const PORTAL_ROUTE_PREFIX = '/portal';

export type RouteDecision =
  | { type: 'next' }
  | { type: 'rewrite'; pathname: string }
  | { type: 'notFound' }
  | { type: 'signIn'; callbackURL: string };

export function routeRequest({
  surface,
  pathname,
  search,
  hasSessionCookie,
}: {
  surface: Surface;
  pathname: string;
  search: string;
  hasSessionCookie: boolean;
}): RouteDecision {
  if (surface === 'team' && matchesPrefix(pathname, PORTAL_ROUTE_PREFIX)) return { type: 'notFound' };
  if (isSharedPublicPath(pathname)) return { type: 'next' };
  if (!hasSessionCookie) return { type: 'signIn', callbackURL: `${pathname}${search}` };
  if (surface === 'portal') {
    return { type: 'rewrite', pathname: pathname === '/' ? PORTAL_ROUTE_PREFIX : `${PORTAL_ROUTE_PREFIX}${pathname}` };
  }
  return { type: 'next' };
}
