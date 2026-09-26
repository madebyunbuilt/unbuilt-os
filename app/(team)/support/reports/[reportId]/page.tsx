import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ReportDetail } from '@/components/support/report-detail';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'SLA report' };

export default async function ReportPage({ params }: PageProps<'/support/reports/[reportId]'>) {
  const { reportId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['sla.manage']} what="SLA reports">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <ReportDetail reportId={reportId as Id<'slaReports'>} />
      </div>
    </RequirePermission>
  );
}
