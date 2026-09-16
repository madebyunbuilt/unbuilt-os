import type { Metadata } from 'next';
import { MembersPanel } from '@/components/projects/members-panel';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Project members' };

export default async function ProjectMembersPage({ params }: PageProps<'/projects/[projectId]/members'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <MembersPanel projectId={projectId as Id<'projects'>} permissions={permissions} />;
}
