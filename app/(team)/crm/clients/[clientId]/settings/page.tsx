import type { Metadata } from 'next';
import { ClientSettings } from '@/components/crm/client-settings';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client settings' };

export default async function ClientSettingsPage({ params }: PageProps<'/crm/clients/[clientId]/settings'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ClientSettings clientId={clientId as Id<'clients'>} permissions={permissions} />;
}
