import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalTickets } from '@/components/portal/portal-tickets';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Support' };

export default async function PortalTicketsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.tickets.view']} what="support">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Support</h1>
        <PortalTickets />
      </div>
    </RequirePermission>
  );
}
