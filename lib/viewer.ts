import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { api } from '@/convex/_generated/api';
import { authServer } from '@/lib/auth-server';
import { SURFACE_HEADER, type Surface, surfaceForHost } from '@/lib/surface';

export type Viewer = typeof api.auth.viewer._returnType;

/** The surface this request arrived on, as decided by proxy.ts. */
export async function currentSurface(): Promise<Surface> {
  const requestHeaders = await headers();
  const fromProxy = requestHeaders.get(SURFACE_HEADER);
  return fromProxy === 'portal' || fromProxy === 'team' ? fromProxy : surfaceForHost(requestHeaders.get('host'));
}

/** The signed-in viewer, or null when there is no usable session. */
export async function getViewer(): Promise<Viewer | null> {
  // Always per request; also keeps the build from prerendering pages that need a session.
  await connection();
  const { isAuthenticated, fetchAuthQuery } = authServer();
  if (!(await isAuthenticated())) return null;
  try {
    return await fetchAuthQuery(api.auth.viewer, {});
  } catch {
    return null;
  }
}

/**
 * For pages behind sign-in. Sends people without a session to sign in and team members without 2FA to set it up.
 * `allowed` is false when the account belongs to the other surface or has no active principal.
 */
export async function requireViewer(surface: Surface): Promise<{ viewer: Viewer; allowed: boolean }> {
  const viewer = await getViewer();
  if (!viewer) redirect('/sign-in');
  if (surface === 'team' && viewer.needsTwoFactorSetup) redirect('/setup/two-factor');
  const expected = surface === 'team' ? 'team' : 'client';
  return { viewer, allowed: viewer.principal?.kind === expected };
}
