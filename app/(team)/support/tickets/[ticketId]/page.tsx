import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { TicketDetail } from '@/components/support/ticket-detail';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: PageProps<'/support/tickets/[ticketId]'>) {
  const { ticketId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['tickets.view.all', 'tickets.view.assigned']} what="tickets">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <TicketDetail ticketId={ticketId as Id<'tickets'>} permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
