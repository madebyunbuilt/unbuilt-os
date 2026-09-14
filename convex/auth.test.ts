import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { makeFunctionReference } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from './_generated/api';
import { type AuthEmail, sendAuthEmail } from './lib/authEmails';
import { newTest, seedRoles, type TestConvex } from './test.auth';

// The sign-in flows end to end, through Better Auth's HTTP routes: magic link, then TOTP for the team and an emailed
// code on new devices for client users (03-auth-and-permissions.md, Sign-in).

vi.mock('./lib/authEmails', () => ({ sendAuthEmail: vi.fn() }));

const teamRead = makeFunctionReference<'query'>('lib/functions.fixtures:teamRead');
const portalOwnClient = makeFunctionReference<'query'>('lib/functions.fixtures:portalOwnClient');

const HOST = 'localhost:3000';
const ORIGIN = `http://${HOST}`;

/** A browser: keeps cookies between requests to the auth routes, as the Next.js proxy would forward them. */
class Browser {
  private cookies = new Map<string, string>();

  constructor(private readonly t: TestConvex) {}

  cookieNames() {
    return [...this.cookies.keys()];
  }

  async request(path: string, { method = 'GET', body }: { method?: 'GET' | 'POST'; body?: unknown } = {}) {
    const headers = new Headers({
      origin: ORIGIN,
      'x-forwarded-host': HOST,
      'x-forwarded-proto': 'http',
      'x-better-auth-forwarded-host': HOST,
      'x-better-auth-forwarded-proto': 'http',
    });
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const response = await this.t.fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';').map((part) => part.trim());
      const [name, ...value] = pair.split('=');
      const expired = attributes.some((a) => /^max-age=0$/i.test(a) || /^expires=thu, 01 jan 1970/i.test(a));
      if (expired || value.join('=') === '') this.cookies.delete(name);
      else this.cookies.set(name, value.join('='));
    }
    return response;
  }
}

const sentEmails = () => vi.mocked(sendAuthEmail).mock.calls.map(([email]) => email as AuthEmail);

function lastEmail<K extends AuthEmail['kind']>(kind: K): Extract<AuthEmail, { kind: K }> {
  const email = sentEmails()
    .filter((e) => e.kind === kind)
    .at(-1);
  if (!email) throw new Error(`No ${kind} email was sent`);
  return email as Extract<AuthEmail, { kind: K }>;
}

/** Path and query of a sign-in link, as the browser would request it. */
const pathOf = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

async function signInWithMagicLink(browser: Browser, email: string) {
  const requested = await browser.request('/api/auth/sign-in/magic-link', {
    method: 'POST',
    body: { email, callbackURL: '/dashboard' },
  });
  expect(requested.status).toBe(200);
  return await browser.request(pathOf(lastEmail('magicLink').url));
}

async function sessionsFor(t: TestConvex, email: string) {
  return await t.run(async (ctx) => {
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: 'email', value: email }],
    });
    if (!user) return { user: null, sessions: [] };
    const { page } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'session',
      where: [{ field: 'userId', value: user._id }],
      paginationOpts: { cursor: null, numItems: 10 },
    });
    return { user, sessions: page };
  });
}

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;

beforeEach(async () => {
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-at-least-32-characters-long');
  vi.mocked(sendAuthEmail).mockClear();
  t = newTest();
  roles = await seedRoles(t);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('signing keys', () => {
  it('are served to Convex, which fetches them without the app’s forwarded host', async () => {
    const response = await t.fetch('/api/auth/convex/jwks');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { keys: unknown[] }).keys.length).toBeGreaterThan(0);
  });
});

describe('invitation-only sign-in', () => {
  it('sends no link and creates no account for an address without an invitation', async () => {
    const browser = new Browser(t);
    const response = await browser.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body: { email: 'stranger@example.com', callbackURL: '/' },
    });
    expect(response.status).toBe(200);
    expect(sentEmails()).toEqual([]);
    expect((await sessionsFor(t, 'stranger@example.com')).user).toBeNull();
  });
});

describe('team sign-in: magic link then TOTP', () => {
  const email = 'dayo@unbuilt.studio';

  beforeEach(async () => {
    await t.run((ctx) =>
      ctx.db.insert('teamMembers', {
        name: 'Dayo',
        email,
        employmentType: 'employee',
        roleId: roles.project_manager,
        status: 'invited',
        timezone: 'Africa/Lagos',
        skills: [],
      }),
    );
  });

  it('enrols TOTP on first sign-in, then requires it on every sign-in', async () => {
    // First sign-in: the invitation is accepted, but team functions stay closed until 2FA is set up.
    const browser = new Browser(t);
    const first = await signInWithMagicLink(browser, email);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe(`${ORIGIN}/dashboard`);

    const { user, sessions } = await sessionsFor(t, email);
    expect(user?.twoFactorEnabled).toBeFalsy();
    const member = await t.run((ctx) => ctx.db.query('teamMembers').first());
    expect(member).toMatchObject({ status: 'active', authUserId: user?._id });

    const firstSession = t.withIdentity({ subject: user!._id, sessionId: sessions[0]._id });
    await expect(firstSession.query(teamRead, {})).rejects.toThrow(/two-factor/i);
    expect(await firstSession.query(api.auth.viewer, {})).toMatchObject({ needsTwoFactorSetup: true });

    // Enrol an authenticator.
    const enabled = await browser.request('/api/auth/two-factor/enable', { method: 'POST', body: {} });
    expect(enabled.status).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const secret = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get('secret')!));
    const totp = () => createOTP(secret, { digits: 6 }).totp();
    const confirmed = await browser.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: { code: await totp() },
    });
    expect(confirmed.status).toBe(200);
    expect((await sessionsFor(t, email)).user?.twoFactorEnabled).toBe(true);

    // It cannot be switched off or replaced by the member.
    expect((await browser.request('/api/auth/two-factor/disable', { method: 'POST', body: {} })).status).toBe(403);
    expect((await browser.request('/api/auth/two-factor/enable', { method: 'POST', body: {} })).status).toBe(403);

    // Next sign-in, from a fresh browser: the magic link alone yields no session.
    const next = new Browser(t);
    const sessionsBefore = (await sessionsFor(t, email)).sessions.length;
    const challenged = await signInWithMagicLink(next, email);
    expect(challenged.status).toBe(302);
    const location = new URL(challenged.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in/verify');
    expect(location.searchParams.get('method')).toBe('totp');
    expect(location.searchParams.get('callbackURL')).toBe('/dashboard');
    expect(next.cookieNames().some((name) => name.endsWith('session_token'))).toBe(false);
    expect((await sessionsFor(t, email)).sessions).toHaveLength(sessionsBefore);

    // Team members cannot fall back to an emailed code.
    expect((await next.request('/api/auth/two-factor/send-otp', { method: 'POST', body: {} })).status).toBe(403);

    // A wrong code fails; the right one creates the session.
    const wrong = await next.request('/api/auth/two-factor/verify-totp', { method: 'POST', body: { code: '000000' } });
    expect(wrong.status).toBe(401);
    const verified = await next.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: { code: await totp() },
    });
    expect(verified.status).toBe(200);
    expect(next.cookieNames().some((name) => name.endsWith('session_token'))).toBe(true);

    const newest = (await sessionsFor(t, email)).sessions.at(-1)!;
    const session = t.withIdentity({ subject: user!._id, sessionId: newest._id });
    expect(await session.query(teamRead, {})).toMatchObject({ memberId: member!._id });

    // An active session gets tokens. After 12 idle hours, the next request ends it instead of refreshing it.
    expect((await next.request('/api/auth/convex/token')).status).toBe(200);
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: 'session',
          where: [{ field: '_id', value: newest._id }],
          update: { updatedAt: Date.now() - 12 * 60 * 60 * 1000 - 60_000 },
        },
      }),
    );
    expect((await next.request('/api/auth/convex/token')).status).toBe(401);
    expect((await sessionsFor(t, email)).sessions.some((session: { _id: string }) => session._id === newest._id)).toBe(
      false,
    );
    expect(next.cookieNames().some((name) => name.endsWith('session_token'))).toBe(false);
  });
});

describe('client sign-in: magic link then an emailed code on new devices', () => {
  const email = 'ada@glossup.com';

  beforeEach(async () => {
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert('clients', {
        displayName: 'Glossup',
        kind: 'company',
        status: 'active',
        defaultCurrency: 'NGN',
        timezone: 'Africa/Lagos',
        portalEnabled: true,
      });
      await ctx.db.insert('contacts', {
        clientId,
        name: 'Ada',
        email,
        isPrimary: true,
        isBilling: true,
        portalAccess: true,
        portalRoleId: roles.client_admin,
        status: 'active',
      });
    });
  });

  it('asks for an emailed code, then trusts the device for later sign-ins', async () => {
    const browser = new Browser(t);
    const challenged = await signInWithMagicLink(browser, email);
    expect(challenged.status).toBe(302);
    const location = new URL(challenged.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in/verify');
    expect(location.searchParams.get('method')).toBe('otp');
    expect((await sessionsFor(t, email)).sessions).toHaveLength(0);

    // Client users cannot enrol TOTP.
    expect((await browser.request('/api/auth/two-factor/enable', { method: 'POST', body: {} })).status).toBe(403);

    expect((await browser.request('/api/auth/two-factor/send-otp', { method: 'POST', body: {} })).status).toBe(200);
    const { code } = lastEmail('signInCode');
    expect(code).toMatch(/^\d{6}$/);
    const verified = await browser.request('/api/auth/two-factor/verify-otp', {
      method: 'POST',
      body: { code, trustDevice: true },
    });
    expect(verified.status).toBe(200);

    const { user, sessions } = await sessionsFor(t, email);
    expect(sessions).toHaveLength(1);
    const session = t.withIdentity({ subject: user!._id, sessionId: sessions[0]._id });
    expect(await session.query(portalOwnClient, {})).toBe('Glossup');
    await expect(session.query(teamRead, {})).rejects.toThrow();

    // Once signed in, a client user still cannot enrol TOTP.
    expect((await browser.request('/api/auth/two-factor/enable', { method: 'POST', body: {} })).status).toBe(403);

    // Client sessions are not ended by 12 idle hours.
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: 'session',
          where: [{ field: '_id', value: sessions[0]._id }],
          update: { updatedAt: Date.now() - 13 * 60 * 60 * 1000 },
        },
      }),
    );
    expect((await browser.request('/api/auth/convex/token')).status).toBe(200);

    // Same device, later: the magic link signs straight in.
    await browser.request('/api/auth/sign-out', { method: 'POST', body: {} });
    const codesBefore = sentEmails().filter((e) => e.kind === 'signInCode').length;
    const trusted = await signInWithMagicLink(browser, email);
    expect(trusted.status).toBe(302);
    expect(trusted.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
    expect(sentEmails().filter((e) => e.kind === 'signInCode')).toHaveLength(codesBefore);

    // A new device is challenged again.
    const other = new Browser(t);
    const again = await signInWithMagicLink(other, email);
    expect(new URL(again.headers.get('location')!).pathname).toBe('/sign-in/verify');
  });

  it('uses each magic link only once', async () => {
    const browser = new Browser(t);
    await signInWithMagicLink(browser, email);
    const reused = await new Browser(t).request(pathOf(lastEmail('magicLink').url));
    expect(new URL(reused.headers.get('location')!).searchParams.get('error')).toBe('INVALID_TOKEN');
  });
});
