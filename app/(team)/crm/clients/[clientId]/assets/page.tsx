import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ClientAssets } from '@/components/support/client-assets';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client renewals' };

export default async function ClientAssetsPage({ params }: PageProps<'/crm/clients/[clientId]/assets'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['assets.manage']} what="renewals">
      <ClientAssets clientId={clientId as Id<'clients'>} />
    </RequirePermission>
  );
}
