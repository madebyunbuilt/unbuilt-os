import type { Metadata } from 'next';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client portal' };

// Placeholder until the client portal module lands.
export default async function PortalHome() {
  const viewer = await getViewer();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <h1 className="font-display text-3xl font-bold">Welcome, {viewer?.principal?.name ?? viewer?.email}</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Your projects, documents and invoices with Unbuilt Studio will appear here.
      </p>
    </div>
  );
}
