import 'server-only';
import { convexBetterAuthNextJs } from '@convex-dev/better-auth/nextjs';

type AuthServer = ReturnType<typeof convexBetterAuthNextJs>;

let server: AuthServer | undefined;

/** Created on first use, so a build without Convex environment variables still compiles. */
export function authServer(): AuthServer {
  server ??= convexBetterAuthNextJs({
    convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? '',
    convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? '',
  });
  return server;
}
