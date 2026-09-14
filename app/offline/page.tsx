import type { Metadata } from 'next';
import { Mark } from '@/components/brand/mark';

export const metadata: Metadata = { title: 'Offline' };

/** Served by the service worker when there is no connection. Static, so it can be cached. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Mark size={32} />
      <h1 className="mt-6 font-display text-2xl font-bold">You are offline</h1>
      <p className="mt-2 text-muted-foreground">
        Unbuilt OS needs a connection to show your work. Nothing is lost; reconnect and reload the page.
      </p>
    </main>
  );
}
