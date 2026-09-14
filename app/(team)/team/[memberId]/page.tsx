import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MemberProfile } from '@/components/team/member-profile';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Team member' };

export default async function MemberPage({ params }: PageProps<'/team/[memberId]'>) {
  const { memberId } = await params;
  const viewer = await getViewer();
  const permissions = viewer?.permissions ?? [];
  if (!permissions.includes('team.view')) redirect('/team/me');
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
      <MemberProfile memberId={memberId as Id<'teamMembers'>} permissions={permissions} />
    </div>
  );
}
