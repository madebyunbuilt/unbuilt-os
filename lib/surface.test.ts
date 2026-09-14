import { describe, expect, it } from 'vitest';
import { routeRequest, surfaceForHost } from './surface';

describe('surfaceForHost', () => {
  it.each([
    ['os.unbuilt.studio', 'team'],
    ['localhost:3000', 'team'],
    ['unbuilt-os.vercel.app', 'team'],
    ['unbuilt-os-pr-12.vercel.app', 'team'],
    ['portal.unbuilt.studio', 'portal'],
    ['PORTAL.unbuilt.studio', 'portal'],
    ['portal.localhost:3000', 'portal'],
    ['unbuilt-os-portal-pr-12.vercel.app', 'portal'],
    ['notportal.unbuilt.studio', 'team'],
    [null, 'team'],
  ])('%s is the %s surface', (host, surface) => {
    expect(surfaceForHost(host)).toBe(surface);
  });
});

describe('routeRequest', () => {
  const signedIn = { search: '', hasSessionCookie: true };

  it('rewrites portal pages under /portal on the portal host', () => {
    expect(routeRequest({ ...signedIn, surface: 'portal', pathname: '/' })).toEqual({
      type: 'rewrite',
      pathname: '/portal',
    });
    expect(routeRequest({ ...signedIn, surface: 'portal', pathname: '/invoices' })).toEqual({
      type: 'rewrite',
      pathname: '/portal/invoices',
    });
  });

  it('returns 404 for portal routes on the team host', () => {
    expect(routeRequest({ ...signedIn, surface: 'team', pathname: '/portal' })).toEqual({ type: 'notFound' });
    expect(routeRequest({ ...signedIn, surface: 'team', pathname: '/portal/invoices' })).toEqual({ type: 'notFound' });
  });

  it('keeps team routes unreachable from the portal host', () => {
    // A team path on the portal host resolves inside /portal, where it does not exist.
    expect(routeRequest({ ...signedIn, surface: 'portal', pathname: '/setup/two-factor' })).toEqual({
      type: 'rewrite',
      pathname: '/portal/setup/two-factor',
    });
  });

  it('serves sign-in, signing, paying and the auth API on both hosts', () => {
    for (const surface of ['team', 'portal'] as const) {
      for (const pathname of [
        '/sign-in',
        '/sign-in/verify',
        '/api/auth/get-session',
        '/sign/abc',
        '/pay/abc',
        '/offline',
        '/manifest.webmanifest',
        '/sw.js',
      ]) {
        expect(routeRequest({ surface, pathname, search: '', hasSessionCookie: false })).toEqual({ type: 'next' });
      }
    }
  });

  it('sends visitors without a session to sign in, keeping where they were going', () => {
    expect(routeRequest({ surface: 'team', pathname: '/clients', search: '?page=2', hasSessionCookie: false })).toEqual(
      {
        type: 'signIn',
        callbackURL: '/clients?page=2',
      },
    );
    expect(routeRequest({ surface: 'portal', pathname: '/', search: '', hasSessionCookie: false })).toEqual({
      type: 'signIn',
      callbackURL: '/',
    });
  });
});
