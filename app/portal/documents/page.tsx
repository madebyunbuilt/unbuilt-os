import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalDocuments } from '@/components/portal/portal-documents';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Documents' };

export default async function PortalDocumentsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.documents.view']} what="documents">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Documents</h1>
        <PortalDocuments />
      </div>
    </RequirePermission>
  );
}
