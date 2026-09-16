import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ProjectList } from '@/components/projects/project-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission
      permissions={permissions}
      anyOf={['projects.view.all', 'projects.view.assigned']}
      what="projects"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Projects</h1>
        <ProjectList permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
