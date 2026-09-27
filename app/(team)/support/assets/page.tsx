import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { AssetList } from '@/components/support/asset-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Renewals' };

export default async function AssetsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['assets.manage']} what="renewals">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">Renewals</h1>
          <p className="text-muted-foreground">
            Domains, hosting and subscriptions Unbuilt keeps alive for its clients, soonest first.
          </p>
        </div>
        <AssetList />
      </div>
    </RequirePermission>
  );
}
