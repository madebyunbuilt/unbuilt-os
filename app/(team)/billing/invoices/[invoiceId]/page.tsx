import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { InvoicePage } from '@/components/billing/invoice-page';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Invoice' };

export default async function SingleInvoicePage({ params }: PageProps<'/billing/invoices/[invoiceId]'>) {
  const { invoiceId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['invoices.view']} what="invoices">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <InvoicePage invoiceId={invoiceId as Id<'invoices'>} permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
