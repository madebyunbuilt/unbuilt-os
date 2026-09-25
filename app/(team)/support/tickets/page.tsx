import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { TicketList } from '@/components/support/ticket-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Tickets' };

export default async function TicketsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['tickets.view.all', 'tickets.view.assigned']} what="tickets">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">Tickets</h1>
          <p className="text-muted-foreground">
            What clients have asked for, with whatever is closest to running out of time first.
          </p>
        </div>
        <TicketList permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
