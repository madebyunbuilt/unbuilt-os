import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { VaultList } from '@/components/vault/vault-list';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client vault' };

export default async function ClientVaultPage({ params }: PageProps<'/crm/clients/[clientId]/vault'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['vault.view.all', 'vault.view.assigned']} what="the vault">
      <VaultList
        clientId={clientId as Id<'clients'>}
        canManage={permissions.includes('vault.manage')}
        canSeeAll={permissions.includes('vault.view.all')}
      />
    </RequirePermission>
  );
}
