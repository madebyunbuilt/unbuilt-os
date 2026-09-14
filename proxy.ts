import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';
import { routeRequest, SURFACE_HEADER, surfaceForHost } from '@/lib/surface';

export function proxy(request: NextRequest) {
  const surface = surfaceForHost(request.headers.get('host'));
  const { pathname, search } = request.nextUrl;
  // Only an optimistic check; pages and Convex functions verify the session.
  const decision = routeRequest({ surface, pathname, search, hasSessionCookie: !!getSessionCookie(request) });

  const headers = new Headers(request.headers);
  headers.set(SURFACE_HEADER, surface);

  switch (decision.type) {
    case 'notFound':
      return NextResponse.rewrite(new URL('/_not-found', request.url), { request: { headers } });
    case 'signIn': {
      const signIn = new URL('/sign-in', request.url);
      if (decision.callbackURL !== '/') signIn.searchParams.set('callbackURL', decision.callbackURL);
      return NextResponse.redirect(signIn);
    }
    case 'rewrite':
      return NextResponse.rewrite(new URL(`${decision.pathname}${search}`, request.url), { request: { headers } });
    case 'next':
      return NextResponse.next({ request: { headers } });
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|brand/|icon\\.svg|apple-icon\\.png|icon-\\d+\\.png|favicon\\.ico).*)'],
};
