import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { VaultList } from '@/components/vault/vault-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Vault' };

export default async function VaultPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['vault.view.all', 'vault.view.assigned']} what="the vault">
      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>
          <p className="text-muted-foreground">
            Client credentials, encrypted. Every reveal and copy is recorded against the person who asked.
          </p>
        </div>
        <VaultList
          canManage={permissions.includes('vault.manage')}
          canSeeAll={permissions.includes('vault.view.all')}
          showClient
        />
      </div>
    </RequirePermission>
  );
}
