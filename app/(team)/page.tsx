import type { Metadata } from 'next';
import { MyTasks } from '@/components/projects/my-tasks';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Home' };

// Filling up as each part of the OS is built; the role dashboards land with reports (14-platform.md).
export default async function TeamHome() {
  const viewer = await getViewer();
  const permissions = viewer?.permissions ?? [];
  const canSeeProjects = ['projects.view.all', 'projects.view.assigned'].some((key) => permissions.includes(key));
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
      <div>
        <h1 className="font-display text-3xl font-bold">Welcome, {viewer?.principal?.name ?? viewer?.email}</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Your dashboard lands here as each part of the OS is built. Parts not built yet are marked in the menu.
        </p>
      </div>
      {canSeeProjects && <MyTasks />}
    </div>
  );
}
