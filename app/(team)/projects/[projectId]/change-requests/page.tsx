import type { Metadata } from 'next';
import { ChangeRequestsPanel } from '@/components/projects/change-requests-panel';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Change requests' };

export default async function ProjectChangeRequestsPage({
  params,
}: PageProps<'/projects/[projectId]/change-requests'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ChangeRequestsPanel projectId={projectId as Id<'projects'>} permissions={permissions} />;
}
