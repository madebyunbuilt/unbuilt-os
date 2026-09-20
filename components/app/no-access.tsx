import { SignOutButton } from '@/components/auth/sign-out-button';
import { Mark } from '@/components/brand/mark';
import { Button } from '@/components/ui/button';
import { type Surface } from '@/lib/surface';
import { type Viewer } from '@/lib/viewer';

/** A signed-in account that cannot use this surface: a client on the team app, a team member on the portal, or neither. */
export function NoAccess({ surface, viewer }: { surface: Surface; viewer: Viewer }) {
  const kind = viewer.principal?.kind;
  const belongsElsewhere = (kind === 'client' && surface === 'team') || (kind === 'team' && surface === 'portal');
  // The deployment tells us where the account belongs; a host with no pair configured simply offers no link.
  const home = belongsElsewhere ? viewer.homeOrigin : undefined;

  const explanation = belongsElsewhere
    ? kind === 'client'
      ? 'This account belongs to the client portal.'
      : 'This account belongs to the studio team app.'
    : 'This account does not have access. If you think it should, contact the studio.';

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Mark size={32} />
      <h1 className="mt-6 font-display text-2xl font-bold">No access here</h1>
      <p className="mt-2 text-muted-foreground">
        You are signed in as <span className="font-medium text-foreground">{viewer.email}</span>. {explanation}
        {belongsElsewhere && !home && ' Sign in there instead.'}
      </p>
      <div className="mt-8 flex flex-wrap gap-2">
        {home && (
          <Button asChild>
            <a href={`${home}/sign-in`}>{kind === 'client' ? 'Go to the client portal' : 'Go to the team app'}</a>
          </Button>
        )}
        <SignOutButton />
      </div>
    </main>
  );
}
