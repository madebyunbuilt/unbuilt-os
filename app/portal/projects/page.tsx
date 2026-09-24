import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalProjects } from '@/components/portal/portal-projects';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Projects' };

export default async function PortalProjectsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.projects.view']} what="projects">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Projects</h1>
        <PortalProjects />
      </div>
    </RequirePermission>
  );
}
