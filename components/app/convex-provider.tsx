'use client';

import { type AuthClient, ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { ConvexReactClient } from 'convex/react';
import { type ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? '', { expectAuth: true });

/** Convex with the signed-in session. initialToken comes from the server so the first render is authenticated. */
export function ConvexProvider({ children, initialToken }: { children: ReactNode; initialToken?: string | null }) {
  return (
    // The provider's AuthClient type cannot express extra plugins' session types; it only needs the base client.
    <ConvexBetterAuthProvider
      client={convex}
      authClient={authClient as unknown as AuthClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
