import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { TimeApprovals } from '@/components/time/approvals';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Time approvals' };

export default async function TimeApprovalsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['time.approve']} what="time approvals">
      <TimeApprovals permissions={permissions} />
    </RequirePermission>
  );
}
