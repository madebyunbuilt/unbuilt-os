import type { Metadata } from 'next';
import { ProjectSettings } from '@/components/projects/project-settings';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Project settings' };

export default async function ProjectSettingsPage({ params }: PageProps<'/projects/[projectId]/settings'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ProjectSettings projectId={projectId as Id<'projects'>} permissions={permissions} />;
}
