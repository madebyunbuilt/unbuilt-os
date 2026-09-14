import type { Metadata } from 'next';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Mark } from '@/components/brand/mark';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Home' };

// Placeholder until the app shell lands.
export default async function TeamHome() {
  const viewer = await getViewer();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-16">
      <Mark size={32} />
      <h1 className="mt-6 font-display text-3xl font-bold">Unbuilt OS</h1>
      <p className="mt-2 text-muted-foreground">Signed in as {viewer?.principal?.name ?? viewer?.email}.</p>
      <div className="mt-8">
        <SignOutButton />
      </div>
    </main>
  );
}
