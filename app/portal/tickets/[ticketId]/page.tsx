import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalTicket } from '@/components/portal/portal-tickets';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Ticket' };

export default async function PortalTicketPage({ params }: PageProps<'/portal/tickets/[ticketId]'>) {
  const { ticketId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.tickets.view']} what="support">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <PortalTicket ticketId={ticketId as Id<'tickets'>} />
      </div>
    </RequirePermission>
  );
}
