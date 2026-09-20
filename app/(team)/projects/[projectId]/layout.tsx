import { RequirePermission } from '@/components/app/require-permission';
import { ProjectHeader } from '@/components/projects/project-header';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export default async function ProjectLayout({ children, params }: LayoutProps<'/projects/[projectId]'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission
      permissions={permissions}
      anyOf={['projects.view.all', 'projects.view.assigned']}
      what="projects"
    >
      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
        <ProjectHeader projectId={projectId as Id<'projects'>} permissions={permissions} />
        {children}
      </div>
    </RequirePermission>
  );
}
