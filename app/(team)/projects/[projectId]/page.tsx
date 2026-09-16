import type { Metadata } from 'next';
import { ProjectOverview } from '@/components/projects/project-overview';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Project' };

export default async function ProjectOverviewPage({ params }: PageProps<'/projects/[projectId]'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ProjectOverview projectId={projectId as Id<'projects'>} permissions={permissions} />;
}
