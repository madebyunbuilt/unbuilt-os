import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalReports } from '@/components/portal/portal-reports';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Reports' };

export default async function PortalReportsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.reports.view']} what="reports">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Reports</h1>
        <PortalReports />
      </div>
    </RequirePermission>
  );
}
