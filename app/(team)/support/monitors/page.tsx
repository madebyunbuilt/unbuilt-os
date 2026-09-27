import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { MonitorList } from '@/components/support/monitor-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Monitors' };

export default async function MonitorsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['monitors.manage']} what="monitors">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">Monitors</h1>
          <p className="text-muted-foreground">
            Addresses Unbuilt watches for its clients. Two failures in a row open an incident and raise a ticket.
          </p>
        </div>
        <MonitorList />
      </div>
    </RequirePermission>
  );
}
