import type { Metadata } from 'next';
import { MilestonesPanel } from '@/components/projects/milestones-panel';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Milestones and deliverables' };

export default async function ProjectMilestonesPage({ params }: PageProps<'/projects/[projectId]/milestones'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <MilestonesPanel projectId={projectId as Id<'projects'>} permissions={permissions} />;
}
