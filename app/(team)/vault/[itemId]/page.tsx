import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { VaultItem } from '@/components/vault/vault-item';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Credential' };

export default async function VaultItemPage({ params }: PageProps<'/vault/[itemId]'>) {
  const { itemId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['vault.view.all', 'vault.view.assigned']} what="the vault">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <VaultItem itemId={itemId as Id<'vaultItems'>} canManage={permissions.includes('vault.manage')} />
      </div>
    </RequirePermission>
  );
}
