import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ReportList } from '@/components/support/report-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'SLA reports' };

export default async function ReportsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['sla.manage']} what="SLA reports">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">SLA reports</h1>
          <p className="text-muted-foreground">
            How the studio did against what it promised, one month at a time. Nothing reaches a client until you send
            it.
          </p>
        </div>
        <ReportList />
      </div>
    </RequirePermission>
  );
}
