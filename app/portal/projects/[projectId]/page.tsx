import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalProject } from '@/components/portal/portal-projects';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Project' };

export default async function PortalProjectPage({ params }: PageProps<'/portal/projects/[projectId]'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.projects.view']} what="projects">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <PortalProject projectId={projectId as Id<'projects'>} />
      </div>
    </RequirePermission>
  );
}
