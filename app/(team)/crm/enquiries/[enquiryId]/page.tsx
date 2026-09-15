import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { EnquiryDetail } from '@/components/crm/enquiry-detail';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Enquiry' };

export default async function EnquiryPage({ params }: PageProps<'/crm/enquiries/[enquiryId]'>) {
  const { enquiryId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['enquiries.view']} what="enquiries">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <EnquiryDetail enquiryId={enquiryId as Id<'enquiries'>} permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
