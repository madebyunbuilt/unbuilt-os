import { createHMAC } from '@better-auth/utils/hmac';
import { type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { deleteSessionCookie, expireCookie } from 'better-auth/cookies';
import { generateRandomString, symmetricEncrypt } from 'better-auth/crypto';

// Better Auth runs its two-factor challenge only after password, username and phone sign-in. Unbuilt OS signs in with
// magic links, so these plugins apply the same challenge after /magic-link/verify and hold each surface to its method:
// TOTP for the team, an emailed code on new devices for client users (03-auth-and-permissions.md, Sign-in).
//
// The cookie names and verification records match better-auth/plugins/two-factor, so its verify endpoints complete the
// sign-in. convex/auth.test.ts proves the whole flow, which catches any drift when Better Auth is upgraded.

const TWO_FACTOR_COOKIE_NAME = 'two_factor';
const TRUST_DEVICE_COOKIE_NAME = 'trust_device';
const TWO_FACTOR_COOKIE_MAX_AGE_SECONDS = 600;
export const TRUST_DEVICE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type PrincipalKind = 'team' | 'client' | null;
export type ResolvePrincipalKind = (user: { id: string; email: string }) => Promise<PrincipalKind>;

/** Where the sign-in screens ask for the second factor. The original callbackURL is passed along. */
export const TWO_FACTOR_PAGE = '/sign-in/verify';

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** Accepts and rotates a trust-device cookie exactly as the two-factor plugin does. */
async function consumeTrustedDevice(ctx: HookContext, userId: string): Promise<boolean> {
  const cookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge: TRUST_DEVICE_MAX_AGE_SECONDS });
  const value = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!value) return false;

  const [token, identifier] = value.split('!');
  const hmac = createHMAC('SHA-256', 'base64urlnopad');
  const valid =
    token &&
    identifier &&
    token === (await hmac.sign(ctx.context.secret, `${userId}!${identifier}`)) &&
    (await ctx.context.internalAdapter
      .findVerificationValue(identifier)
      .then((record) => record?.value === userId && record.expiresAt > new Date()));
  if (!valid) {
    expireCookie(ctx, cookie);
    return false;
  }

  await ctx.context.internalAdapter.deleteVerificationByIdentifier(identifier);
  const nextIdentifier = `trust-device-${generateRandomString(32)}`;
  await ctx.context.internalAdapter.createVerificationValue({
    value: userId,
    identifier: nextIdentifier,
    expiresAt: new Date(Date.now() + TRUST_DEVICE_MAX_AGE_SECONDS * 1000),
  });
  const nextToken = await hmac.sign(ctx.context.secret, `${userId}!${nextIdentifier}`);
  await ctx.setSignedCookie(cookie.name, `${nextToken}!${nextIdentifier}`, ctx.context.secret, cookie.attributes);
  return true;
}

export function magicLinkTwoFactor(resolvePrincipalKind: ResolvePrincipalKind): BetterAuthPlugin {
  return {
    id: 'unbuilt-magic-link-two-factor',
    hooks: {
      after: [
        {
          matcher: (context) => context.path === '/magic-link/verify',
          handler: createAuthMiddleware(async (ctx) => {
            const data = ctx.context.newSession;
            if (!data?.user.twoFactorEnabled) return;

            // Client users skip the emailed code on a device they trusted. Team members always enter TOTP.
            const kind = await resolvePrincipalKind(data.user);
            if (kind === 'client' && (await consumeTrustedDevice(ctx, data.user.id))) return;

            // Discard the session the magic link created; the two-factor verify endpoint creates the real one.
            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(data.session.token);
            ctx.context.setNewSession(null);

            const identifier = `2fa-${generateRandomString(20)}`;
            const expiresAt = new Date(Date.now() + TWO_FACTOR_COOKIE_MAX_AGE_SECONDS * 1000);
            await ctx.context.internalAdapter.createVerificationValue({ value: data.user.id, identifier, expiresAt });
            await ctx.context.internalAdapter.createVerificationValue({
              value: '0',
              identifier: `2fa-attempts-${identifier}`,
              expiresAt,
            });
            const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME, {
              maxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS,
            });
            await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);

            const verifyUrl = new URL(TWO_FACTOR_PAGE, ctx.context.baseURL);
            verifyUrl.searchParams.set('method', kind === 'client' ? 'otp' : 'totp');
            const callbackURL = typeof ctx.query?.callbackURL === 'string' ? ctx.query.callbackURL : '/';
            verifyUrl.searchParams.set('callbackURL', callbackURL.startsWith('/') ? callbackURL : '/');
            throw ctx.redirect(verifyUrl.toString());
          }),
        },
      ],
    },
  };
}

type AuthUser = { id: string; email: string; twoFactorEnabled?: boolean | null };

/** The signed-in user, or the user part-way through a two-factor challenge. */
async function currentOrPendingUser(ctx: HookContext): Promise<AuthUser | null> {
  const session = await getSessionFromCtx(ctx);
  if (session) return session.user;
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const record = await ctx.context.internalAdapter.findVerificationValue(identifier);
  return record ? await ctx.context.internalAdapter.findUserById(record.value) : null;
}

const EMAIL_CODE_PATHS = new Set(['/two-factor/send-otp', '/two-factor/verify-otp']);
const AUTHENTICATOR_PATHS = new Set([
  '/two-factor/verify-totp',
  '/two-factor/get-totp-uri',
  '/two-factor/verify-backup-code',
  '/two-factor/generate-backup-codes',
]);

/**
 * Second-factor rules per surface, checked before any code is generated or compared. Team members use an authenticator
 * app, set it up once, and cannot turn it off or replace it themselves; an admin resets it. Client users only receive
 * emailed codes, which are always on.
 */
export function secondFactorRules(resolvePrincipalKind: ResolvePrincipalKind): BetterAuthPlugin {
  const refuse = (): never => {
    throw new APIError('FORBIDDEN', { message: 'This sign-in method is not available for this account' });
  };
  return {
    id: 'unbuilt-second-factor-rules',
    hooks: {
      before: [
        {
          matcher: (context) => context.path === '/two-factor/disable',
          handler: createAuthMiddleware(async () => refuse()),
        },
        {
          matcher: (context) =>
            context.path === '/two-factor/enable' ||
            EMAIL_CODE_PATHS.has(context.path ?? '') ||
            AUTHENTICATOR_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const user = await currentOrPendingUser(ctx);
            if (!user) return; // the endpoint itself answers callers with no session or challenge
            const kind = await resolvePrincipalKind(user);
            if (ctx.path === '/two-factor/enable') {
              if (kind !== 'team' || user.twoFactorEnabled) refuse();
            } else if (EMAIL_CODE_PATHS.has(ctx.path)) {
              if (kind !== 'client') refuse();
            } else if (kind !== 'team') {
              refuse();
            }
          }),
        },
      ],
    },
  };
}

/**
 * Team sessions end after a period of inactivity. Every authenticated request refreshes the session, so the check has
 * to run first: an idle team session is deleted before Better Auth can refresh it. The session is read straight from
 * the cookie because getSessionFromCtx caches its result for the endpoint, which would stop the normal refresh.
 */
export function expireIdleTeamSessions(
  resolvePrincipalKind: ResolvePrincipalKind,
  resolveLastActiveAt: (session: { id: string; createdAt: Date }) => Promise<number>,
  idleMs: number,
): BetterAuthPlugin {
  return {
    id: 'unbuilt-expire-idle-team-sessions',
    hooks: {
      before: [
        {
          matcher: (context) => !!context.path,
          handler: createAuthMiddleware(async (ctx) => {
            const cookieName = ctx.context.authCookies.sessionToken.name;
            const token = await ctx.getSignedCookie(cookieName, ctx.context.secret);
            if (!token) return;
            const found = await ctx.context.internalAdapter.findSession(token);
            if (!found) return;
            // Real use, not Better Auth's updatedAt: token renewals refresh that while a tab sits untouched.
            const lastActive = await resolveLastActiveAt({
              id: found.session.id,
              createdAt: new Date(found.session.createdAt),
            });
            if (Date.now() - lastActive <= idleMs) return;
            if ((await resolvePrincipalKind(found.user)) !== 'team') return;

            await ctx.context.internalAdapter.deleteSession(token);
            deleteSessionCookie(ctx);
            // Returned rather than thrown: a thrown error would drop the cookies deleteSessionCookie just expired.
            return ctx.json(
              { code: 'SESSION_IDLE', message: 'Your session ended after 12 hours of inactivity' },
              { status: 401 },
            );
          }),
        },
      ],
    },
  };
}

/**
 * Records that a session proved its second factor again, which is what reopens the vault's 15-minute window
 * (10-vault.md, Access).
 *
 * Better Auth's own `/two-factor/verify-totp` is the verifier. Given a live session it checks the code against the
 * stored secret, counts failures towards the account lockout and returns without disturbing the session — exactly a
 * re-verification. Recording it here, from Better Auth's result, is the whole point: a mutation the page called after
 * verifying would be a mutation anyone could call instead of verifying, and the gate would mean nothing.
 *
 * A sign-in challenge runs through the same endpoint and is recorded too. It does not have to be told apart, and the
 * attempt to is what went wrong first: `newSession` is set either way, so the guard meant to skip sign-ins skipped
 * everything. Recording both is also the truer statement — this session proved a second factor at this time — and the
 * vault takes the later of that and the session's start, so a row at sign-in changes no decision.
 */
export function recordSecondFactorChecks(
  record: (input: { authUserId: string; sessionId: string }) => Promise<void>,
): BetterAuthPlugin {
  return {
    id: 'unbuilt-record-second-factor',
    hooks: {
      after: [
        {
          matcher: (context) => context.path === '/two-factor/verify-totp',
          handler: createAuthMiddleware(async (ctx) => {
            // After hooks run for failures too, where what came back is the error rather than a result.
            if (ctx.context.returned instanceof APIError) return;
            // The session this request leaves the person on, which is not always the one it arrived with: verifying can
            // rotate the session, and getSessionFromCtx answers from before the endpoint ran. Recording the older id
            // would pin the proof to a session the browser has already stopped using, and the vault would never see it.
            const established = ctx.context.newSession ?? (await getSessionFromCtx(ctx));
            if (!established?.session) return;
            await record({ authUserId: established.user.id, sessionId: established.session.id });
          }),
        },
      ],
    },
  };
}

/**
 * Better Auth checks emailed codes against a twoFactor record, where it also counts failures and locks accounts. Client
 * users never enrol an authenticator, so they get a record whose secret is random and never revealed.
 */
export async function createEmailCodeRecord(ctx: HookContext, userId: string): Promise<void> {
  const encrypt = (data: string) => symmetricEncrypt({ key: ctx.context.secretConfig, data });
  await ctx.context.adapter.create({
    model: 'twoFactor',
    data: {
      userId,
      secret: await encrypt(generateRandomString(32)),
      backupCodes: await encrypt('[]'),
      verified: false,
    },
  });
}
