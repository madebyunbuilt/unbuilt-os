import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ClientBilling } from '@/components/billing/client-billing';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client invoices and payments' };

export default async function ClientInvoicesPage({ params }: PageProps<'/crm/clients/[clientId]/invoices'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['invoices.view']} what="invoices">
      <ClientBilling clientId={clientId as Id<'clients'>} permissions={permissions} />
    </RequirePermission>
  );
}
