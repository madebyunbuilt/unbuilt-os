import type { Metadata } from 'next';
import Link from 'next/link';
import { RequirePermission } from '@/components/app/require-permission';
import { BillList } from '@/components/billing/bill-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Bills' };

export default async function BillsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['bills.manage', 'bills.pay']} what="bills">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">Bills</h1>
            <p className="text-muted-foreground">
              What the studio owes contractors and suppliers, and the tax it withholds when it pays them.
            </p>
          </div>
          {permissions.includes('vendors.manage') && (
            <Link href="/billing/vendors" className="text-sm underline">
              Vendors
            </Link>
          )}
        </div>
        <BillList permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
