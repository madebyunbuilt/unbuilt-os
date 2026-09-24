import type { Metadata } from 'next';
import Link from 'next/link';
import { RequirePermission } from '@/components/app/require-permission';
import { VendorList } from '@/components/billing/vendor-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Vendors' };

export default async function VendorsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['vendors.manage']} what="vendors">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">Vendors</h1>
            <p className="text-muted-foreground">
              The contractors and suppliers the studio pays, and what it withholds when it pays them.
            </p>
          </div>
          <Link href="/billing/bills" className="text-sm underline">
            Bills
          </Link>
        </div>
        <VendorList />
      </div>
    </RequirePermission>
  );
}
