import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { RateCard } from '@/components/crm/rate-card';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Rate card' };

export default async function RateCardPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['ratecard.view']} what="the rate card">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="font-display text-3xl font-bold">Rate card</h1>
        <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
          Services and their prices, used when adding lines to quotes and invoices.
        </p>
        <RateCard canManage={permissions.includes('ratecard.manage')} />
      </div>
    </RequirePermission>
  );
}
