import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { Timesheet } from '@/components/time/timesheet';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'My time' };

export default async function MyTimePage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['time.log.own']} what="your own time">
      <Timesheet />
    </RequirePermission>
  );
}
