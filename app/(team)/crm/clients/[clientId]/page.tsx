import type { Metadata } from 'next';
import { ClientOverview } from '@/components/crm/client-overview';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client' };

export default async function ClientOverviewPage({ params }: PageProps<'/crm/clients/[clientId]'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ClientOverview clientId={clientId as Id<'clients'>} permissions={permissions} />;
}
