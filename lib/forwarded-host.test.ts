import { describe, expect, it } from 'vitest';
import { onRequestedHost, requestedHost } from './forwarded-host';

// Next.js reports its own address in a route handler's request.url, so the host the browser used has to be put back
// before Better Auth builds redirects from it. Without this a portal sign-in lands on the team app.

const asNextSees = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  new Request(`http://localhost:3000${path}`, { headers, ...init });

describe('requestedHost', () => {
  it('prefers what a proxy forwarded, then the Host header', () => {
    expect(requestedHost(asNextSees('/x', { host: 'portal.localhost:3000' }))).toBe('portal.localhost:3000');
    expect(
      requestedHost(asNextSees('/x', { host: 'internal:3000', 'x-forwarded-host': 'portal.unbuilt.studio' })),
    ).toBe('portal.unbuilt.studio');
    expect(requestedHost(asNextSees('/x', { 'x-forwarded-host': 'portal.unbuilt.studio, proxy' }))).toBe(
      'portal.unbuilt.studio',
    );
  });
});

describe('onRequestedHost', () => {
  it('moves the URL to the host the browser used', () => {
    const moved = onRequestedHost(
      asNextSees('/api/auth/magic-link/verify?token=abc', { host: 'portal.localhost:3000' }),
    );
    expect(moved.url).toBe('http://portal.localhost:3000/api/auth/magic-link/verify?token=abc');
  });

  it('keeps https off localhost, and follows the forwarded protocol', () => {
    expect(onRequestedHost(asNextSees('/x', { host: 'portal.unbuilt.studio' })).url).toBe(
      'https://portal.unbuilt.studio/x',
    );
    expect(onRequestedHost(asNextSees('/x', { host: 'portal.unbuilt.studio', 'x-forwarded-proto': 'http' })).url).toBe(
      'http://portal.unbuilt.studio/x',
    );
  });

  it('leaves a request whose host already agrees exactly as it was', () => {
    const request = asNextSees('/x', { host: 'localhost:3000' });
    expect(onRequestedHost(request)).toBe(request);
  });

  it('carries a posted body across', async () => {
    const posted = onRequestedHost(
      asNextSees(
        '/api/auth/sign-in/magic-link',
        { host: 'portal.localhost:3000', 'content-type': 'application/json' },
        { method: 'POST', body: JSON.stringify({ email: 'ada@glossup.com' }) },
      ),
    );
    expect(posted.method).toBe('POST');
    expect(posted.url).toBe('http://portal.localhost:3000/api/auth/sign-in/magic-link');
    expect(await posted.json()).toEqual({ email: 'ada@glossup.com' });
  });
});
