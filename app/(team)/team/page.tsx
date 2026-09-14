import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TeamList } from '@/components/team/team-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage() {
  const viewer = await getViewer();
  const permissions = viewer?.permissions ?? [];
  // Members without team.view still reach their own profile from the Team menu item.
  if (!permissions.includes('team.view')) redirect('/team/me');
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-bold">Team</h1>
        <nav aria-label="Team pages" className="flex gap-4 text-sm">
          <Link href="/team/time-off" className="underline underline-offset-4">
            Time off
          </Link>
          <Link href="/team/me" className="underline underline-offset-4">
            My profile
          </Link>
        </nav>
      </div>
      <TeamList canInvite={permissions.includes('team.manage')} />
    </div>
  );
}
