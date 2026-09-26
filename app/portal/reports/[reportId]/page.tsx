import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalReport } from '@/components/portal/portal-reports';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Report' };

export default async function PortalReportPage({ params }: PageProps<'/portal/reports/[reportId]'>) {
  const { reportId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.reports.view']} what="reports">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <PortalReport reportId={reportId as Id<'slaReports'>} />
      </div>
    </RequirePermission>
  );
}
