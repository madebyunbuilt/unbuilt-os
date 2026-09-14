import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TimeOffOverview } from '@/components/team/time-off/time-off-overview';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Time off' };

export default async function TimeOffPage() {
  const viewer = await getViewer();
  const permissions = viewer?.permissions ?? [];
  if (!permissions.includes('timeoff.request') && !permissions.includes('timeoff.approve')) redirect('/team/me');
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <TimeOffOverview permissions={permissions} />
    </div>
  );
}
