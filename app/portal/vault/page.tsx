import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalVault } from '@/components/portal/portal-vault';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Credentials' };

export default async function PortalVaultPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.vault.submit']} what="credentials">
      <PortalVault />
    </RequirePermission>
  );
}
