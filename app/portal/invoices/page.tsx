import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalInvoices } from '@/components/portal/portal-invoices';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Invoices' };

export default async function PortalInvoicesPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.invoices.view']} what="invoices">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Invoices</h1>
        <PortalInvoices />
      </div>
    </RequirePermission>
  );
}
