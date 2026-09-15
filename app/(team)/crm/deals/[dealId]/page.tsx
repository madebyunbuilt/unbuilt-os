import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { DealDetail } from '@/components/crm/deal-detail';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Deal' };

export default async function DealPage({ params }: PageProps<'/crm/deals/[dealId]'>) {
  const { dealId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['deals.view']} what="deals">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <DealDetail dealId={dealId as Id<'deals'>} permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
