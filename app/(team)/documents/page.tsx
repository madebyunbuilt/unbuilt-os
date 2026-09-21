import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { DocumentList } from '@/components/documents/document-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Documents' };

export default async function DocumentsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['documents.view', 'documents.view.assigned']} what="documents">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Documents</h1>
        <DocumentList permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
