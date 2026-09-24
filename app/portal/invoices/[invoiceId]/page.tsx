import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalInvoice } from '@/components/portal/portal-invoices';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Invoice' };

export default async function PortalInvoicePage({ params }: PageProps<'/portal/invoices/[invoiceId]'>) {
  const { invoiceId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.invoices.view']} what="invoices">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <PortalInvoice invoiceId={invoiceId as Id<'invoices'>} />
      </div>
    </RequirePermission>
  );
}
