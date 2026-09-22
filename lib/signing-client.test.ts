import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signing } from './signing-client';

// The signing endpoints' client: the token travels in the body, and every failure comes back in one shape.

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_CONVEX_SITE_URL', 'https://example.convex.site');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('signing client', () => {
  it('posts the token in the body, never the address, and sends no referrer', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, sentTo: 'a…@glossup.com' })));
    expect(await signing.code('secret-token-value-123456')).toEqual({ ok: true, sentTo: 'a…@glossup.com' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.convex.site/public/sign/code');
    expect(url).not.toContain('secret-token');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'secret-token-value-123456' });
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('passes the server’s refusal through with its message', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, code: 'signatures.expired', message: 'This signing link has expired' }),
        {
          status: 400,
        },
      ),
    );
    expect(await signing.view('secret-token-value-123456')).toEqual({
      ok: false,
      code: 'signatures.expired',
      message: 'This signing link has expired',
    });
  });

  it('turns a network failure or an unreadable answer into a plain message', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await signing.view('secret-token-value-123456')).toMatchObject({ ok: false, code: 'network' });
    fetchMock.mockResolvedValueOnce(new Response('Something went wrong', { status: 500 }));
    expect(await signing.view('secret-token-value-123456')).toMatchObject({ ok: false, code: 'network' });
  });
});
