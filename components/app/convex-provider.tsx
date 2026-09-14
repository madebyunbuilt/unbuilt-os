'use client';

import { type AuthClient, ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { ConvexReactClient } from 'convex/react';
import { type ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';
import { withTokenRetries } from '@/lib/token-retry';

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? '', { expectAuth: true });

// The auth client with token renewal retried through brief failures (lib/token-retry.ts). The provider calls token()
// with throw: false, so results arrive as `{ data, error }`.
const retryingConvex = {
  token: withTokenRetries(
    (options?: Parameters<typeof authClient.convex.token>[0]) =>
      authClient.convex.token(options) as Promise<{
        data?: { token?: string | null } | null;
        error?: { status?: number } | null;
      }>,
  ),
};
const resilientAuthClient = new Proxy(authClient, {
  get: (target, property, receiver) =>
    property === 'convex' ? retryingConvex : Reflect.get(target, property, receiver),
});

/** Convex with the signed-in session. initialToken comes from the server so the first render is authenticated. */
export function ConvexProvider({ children, initialToken }: { children: ReactNode; initialToken?: string | null }) {
  return (
    // The provider's AuthClient type cannot express extra plugins' session types; it only needs the base client.
    <ConvexBetterAuthProvider
      client={convex}
      authClient={resilientAuthClient as unknown as AuthClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
