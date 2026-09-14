import { SignOutButton } from '@/components/auth/sign-out-button';
import { Mark } from '@/components/brand/mark';
import { type Surface } from '@/lib/surface';
import { type Viewer } from '@/lib/viewer';

/** A signed-in account that cannot use this surface: a client on the team app, a team member on the portal, or neither. */
export function NoAccess({ surface, viewer }: { surface: Surface; viewer: Viewer }) {
  const otherSurface =
    viewer.principal?.kind === 'client' && surface === 'team'
      ? 'This account belongs to the client portal. Sign in there instead.'
      : viewer.principal?.kind === 'team' && surface === 'portal'
        ? 'This account belongs to the studio team app. Sign in there instead.'
        : 'This account does not have access. If you think it should, contact the studio.';

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Mark size={32} />
      <h1 className="mt-6 font-display text-2xl font-bold">No access here</h1>
      <p className="mt-2 text-muted-foreground">
        You are signed in as <span className="font-medium text-foreground">{viewer.email}</span>. {otherSurface}
      </p>
      <div className="mt-8">
        <SignOutButton />
      </div>
    </main>
  );
}
