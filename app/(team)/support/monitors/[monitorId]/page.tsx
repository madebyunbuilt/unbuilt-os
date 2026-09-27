import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { MonitorDetail } from '@/components/support/monitor-detail';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Monitor' };

export default async function MonitorPage({ params }: PageProps<'/support/monitors/[monitorId]'>) {
  const { monitorId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['monitors.manage']} what="monitors">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <MonitorDetail monitorId={monitorId as Id<'monitors'>} />
      </div>
    </RequirePermission>
  );
}
