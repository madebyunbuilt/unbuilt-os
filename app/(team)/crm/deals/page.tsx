import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { DealBoard } from '@/components/crm/deal-board';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Deals' };

export default async function DealsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['deals.view']} what="deals">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Deals</h1>
        <DealBoard permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
