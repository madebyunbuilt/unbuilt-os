import type { Metadata } from 'next';
import { ProjectTimePanel } from '@/components/projects/project-time-panel';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Project time' };

export default async function ProjectTimePage({ params }: PageProps<'/projects/[projectId]/time'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ProjectTimePanel projectId={projectId as Id<'projects'>} permissions={permissions} />;
}
