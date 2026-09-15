'use client';

import Link from 'next/link';
import { isSessionError } from '@/components/app/session-boundary';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/convex-error';

export default function DealsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // An ended session belongs to the session-ended screen around the whole app.
  if (isSessionError(error)) throw error;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <h1 className="font-display text-2xl font-bold">This deal could not be shown</h1>
      <p className="mt-2 text-muted-foreground">
        {errorMessage(error, 'It may have been deleted, or the link is wrong.')}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/crm/deals">Back to deals</Link>
        </Button>
        <Button variant="outline" onClick={() => retry()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
