import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { APIError } from 'better-auth/api';
import { type BetterAuthOptions } from 'better-auth';
import { betterAuth } from 'better-auth/minimal';
import { magicLink, twoFactor } from 'better-auth/plugins';
import { components, internal } from './_generated/api';
import { type DataModel } from './_generated/dataModel';
import { type GenericActionCtx } from 'convex/server';
import authConfig from './auth.config';
import authSchema from './betterAuth/schema';
import { sendAuthEmail } from './lib/authEmails';
import {
  createEmailCodeRecord,
  expireIdleTeamSessions,
  magicLinkTwoFactor,
  type PrincipalKind,
  secondFactorRules,
  TRUST_DEVICE_MAX_AGE_SECONDS,
} from './lib/authPlugins';
import { sessionQuery } from './lib/functions';
import { PORTAL_SESSION_MAX_AGE_SECONDS, TEAM_SESSION_IDLE_MS } from './lib/principals';

// Better Auth inside Convex (03-auth-and-permissions.md). One instance serves os.* and portal.*; cookies stay on the
// host that set them, and every Convex function checks the principal itself.

export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
  local: { schema: authSchema },
});

const MAGIC_LINK_EXPIRES_SECONDS = 15 * 60;
const SESSION_UPDATE_AGE_SECONDS = 15 * 60;
const JWT_EXPIRATION_SECONDS = 15 * 60;

/** Hostnames this deployment serves, e.g. "os.unbuilt.studio,portal.unbuilt.studio". Wildcards allowed for previews. */
function allowedHosts(): string[] {
  const hosts = (process.env.AUTH_ALLOWED_HOSTS ?? 'localhost:3000,portal.localhost:3000')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return hosts;
}

const isLocalHost = (host: string) =>
  host === 'localhost' || host.startsWith('localhost:') || /\.localhost(:\d+)?$/.test(host);
const originOf = (host: string) => `${isLocalHost(host) ? 'http' : 'https'}://${host}`;

function trustedOrigins(hosts: string[]): string[] {
  return hosts.map(originOf);
}

/**
 * The base URL for requests that do not come through the app, such as Convex fetching the signing keys to verify a
 * token. The first exact host is the app's primary address; a deployment that only serves wildcard previews falls back
 * to its own Convex site URL.
 */
function fallbackBaseURL(hosts: string[]): string | undefined {
  const primary = hosts.find((host) => !host.includes('*'));
  return primary ? originOf(primary) : process.env.CONVEX_SITE_URL;
}

/** Sign-in hooks only run inside the HTTP action that serves /api/auth, where functions can be called. */
function runner(ctx: GenericCtx<DataModel>): GenericActionCtx<DataModel> {
  if (!('runMutation' in ctx)) throw new Error('Sign-in flows need a mutation or action context');
  return ctx as GenericActionCtx<DataModel>;
}

/** Better Auth options. Also read by the component adapter and the schema generator, which pass an empty ctx. */
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const hosts = allowedHosts();
  const principalKind = async (user: { id: string; email: string }): Promise<PrincipalKind> =>
    await runner(ctx).runQuery(internal.authFlows.principalKindForUser, { authUserId: user.id, email: user.email });

  return {
    appName: 'Unbuilt OS',
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: { allowedHosts: hosts, fallback: fallbackBaseURL(hosts), protocol: 'auto' },
    trustedOrigins: trustedOrigins(hosts),
    database: authComponent.adapter(ctx),
    session: {
      // Portal sessions last 7 days. Team sessions also end after 12 idle hours (expireIdleTeamSessions and the wrappers).
      expiresIn: PORTAL_SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    rateLimit: { enabled: true, storage: 'database' },
    databaseHooks: {
      user: {
        create: {
          // Invitations only: an account can exist only for an invited team member or a contact with portal access.
          before: async (user) => {
            const kind = await runner(ctx).runQuery(internal.authFlows.principalKindForEmail, { email: user.email });
            if (!kind) return false;
            // A client user's emailed code is their second factor, so it is on from the first sign-in.
            return { data: { ...user, twoFactorEnabled: kind === 'client' } };
          },
          after: async (user, endpoint) => {
            await runner(ctx).runMutation(internal.authFlows.linkAuthUser, { authUserId: user.id, email: user.email });
            if (user.twoFactorEnabled && endpoint) await createEmailCodeRecord(endpoint, user.id);
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_SECONDS,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          const kind = await runner(ctx).runQuery(internal.authFlows.principalKindForEmail, { email });
          // Say nothing to addresses without an invitation, so the form cannot be used to probe who is a client.
          if (!kind) return;
          await sendAuthEmail({ kind: 'magicLink', to: email, url });
        },
      }),
      twoFactor({
        issuer: 'Unbuilt OS',
        allowPasswordless: true,
        trustDeviceMaxAge: TRUST_DEVICE_MAX_AGE_SECONDS,
        otpOptions: {
          storeOTP: 'hashed',
          allowedAttempts: 5,
          sendOTP: async ({ user, otp }) => {
            // Team members use TOTP; only client users receive emailed codes.
            if ((await principalKind(user)) !== 'client') {
              throw new APIError('FORBIDDEN', { message: 'Use your authenticator app' });
            }
            await sendAuthEmail({ kind: 'signInCode', to: user.email, code: otp });
          },
        },
      }),
      expireIdleTeamSessions(principalKind, TEAM_SESSION_IDLE_MS),
      magicLinkTwoFactor(principalKind),
      secondFactorRules(principalKind),
      convex({ authConfig, jwt: { expirationSeconds: JWT_EXPIRATION_SECONDS } }),
    ],
  } satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx));

/** Sign-in state for the current session: what the app needs to route a person to setup, verification or home. */
export const viewer = sessionQuery({
  args: {},
  handler: async (ctx) => {
    const { authUserId, email, twoFactorEnabled } = ctx.session;
    const member = await ctx.db
      .query('teamMembers')
      .withIndex('by_authUser', (q) => q.eq('authUserId', authUserId))
      .unique();
    const contact = member
      ? null
      : await ctx.db
          .query('contacts')
          .withIndex('by_authUser', (q) => q.eq('authUserId', authUserId))
          .unique();

    const principal =
      member?.status === 'active'
        ? { kind: 'team' as const, name: member.name }
        : contact?.status === 'active' && contact.portalAccess
          ? { kind: 'client' as const, name: contact.name }
          : null;
    return { email, principal, needsTwoFactorSetup: principal?.kind === 'team' && !twoFactorEnabled };
  },
});
