import type { Metadata } from 'next';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Home' };

// Placeholder until the role dashboards land (14-platform.md, Dashboards and reports).
export default async function TeamHome() {
  const viewer = await getViewer();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <h1 className="font-display text-3xl font-bold">Welcome, {viewer?.principal?.name ?? viewer?.email}</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Your dashboard lands here as each part of the OS is built. Parts not built yet are marked in the menu.
      </p>
    </div>
  );
}
