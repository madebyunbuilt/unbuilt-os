import type { Metadata } from 'next';
import { TaskBoard } from '@/components/projects/task-board';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Tasks' };

export default async function ProjectTasksPage({ params }: PageProps<'/projects/[projectId]/tasks'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <TaskBoard projectId={projectId as Id<'projects'>} permissions={permissions} />;
}
