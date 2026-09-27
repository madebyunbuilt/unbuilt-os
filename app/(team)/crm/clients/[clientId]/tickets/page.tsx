import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ClientTickets } from '@/components/support/scoped-tickets';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client tickets' };

export default async function ClientTicketsPage({ params }: PageProps<'/crm/clients/[clientId]/tickets'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['tickets.view.all', 'tickets.view.assigned']} what="tickets">
      <ClientTickets clientId={clientId as Id<'clients'>} />
    </RequirePermission>
  );
}
