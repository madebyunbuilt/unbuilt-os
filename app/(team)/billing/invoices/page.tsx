import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { InvoiceList } from '@/components/billing/invoice-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Invoices' };

export default async function InvoicesPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['invoices.view']} what="invoices">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Invoices</h1>
        <InvoiceList permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
