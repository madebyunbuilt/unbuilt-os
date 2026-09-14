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
