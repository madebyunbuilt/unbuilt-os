'use client';

import { ConvexError } from 'convex/values';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Mark } from '@/components/brand/mark';
import { Button } from '@/components/ui/button';

// When the session ends while a page is open (signed out elsewhere, revoked, idle too long, or the token could not be
// refreshed), every query refuses with an auth error. Without this, the first one would crash the page.

const SESSION_CODES: ReadonlySet<string> = new Set(['auth.unauthenticated', 'auth.sessionExpired']);

export function isSessionError(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return typeof data === 'object' && data !== null && SESSION_CODES.has(String((data as { code?: unknown }).code));
}

type State = { error: unknown };

/** Shows "Your session has ended" for session errors from Convex; every other error continues to the error page. */
export class SessionBoundary extends Component<{ children: ReactNode; reload?: () => void }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (!isSessionError(error)) console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (!isSessionError(error)) throw error;
    // A reload fetches a fresh sign-in token; re-rendering alone would retry with the one that failed.
    return <SessionEnded onRetry={this.props.reload ?? (() => window.location.reload())} />;
  }
}

function SessionEnded({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Mark size={32} />
      <h1 className="mt-6 font-display text-2xl font-bold">Your session has ended</h1>
      <p className="mt-2 text-muted-foreground">
        This happens after a long break, when you sign out in another tab, or when the connection drops while your
        sign-in is renewed. Sign in again to carry on.
      </p>
      <div className="mt-8 flex flex-wrap gap-2">
        {/* A full page load, so the server checks the session again. */}
        <Button asChild>
          <a href="/sign-in">Sign in again</a>
        </Button>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </main>
  );
}
