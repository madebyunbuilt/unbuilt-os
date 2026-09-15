import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ClientDeals } from '@/components/crm/client-deals';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client deals' };

export default async function ClientDealsPage({ params }: PageProps<'/crm/clients/[clientId]/deals'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['deals.view']} what="deals">
      <ClientDeals clientId={clientId as Id<'clients'>} permissions={permissions} />
    </RequirePermission>
  );
}
