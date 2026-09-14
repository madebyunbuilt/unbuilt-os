'use client';

import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Talks to /api/auth on whichever host the page is on, so cookies stay on that host.
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), twoFactorClient(), convexClient()],
});
