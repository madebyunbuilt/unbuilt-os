import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { EnquiryList } from '@/components/crm/enquiry-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Enquiries' };

export default async function EnquiriesPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['enquiries.view']} what="enquiries">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Enquiries</h1>
        <EnquiryList canManage={permissions.includes('enquiries.manage')} />
      </div>
    </RequirePermission>
  );
}
