import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { AssetDetail } from '@/components/support/asset-detail';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Renewal' };

export default async function AssetPage({ params }: PageProps<'/support/assets/[assetId]'>) {
  const { assetId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['assets.manage']} what="renewals">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <AssetDetail assetId={assetId as Id<'managedAssets'>} />
      </div>
    </RequirePermission>
  );
}
