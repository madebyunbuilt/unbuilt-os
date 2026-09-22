import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { DocumentPage } from '@/components/documents/document-page';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Document' };

export default async function SingleDocumentPage({ params }: PageProps<'/documents/[documentId]'>) {
  const { documentId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['documents.view', 'documents.view.assigned']} what="documents">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <DocumentPage documentId={documentId as Id<'documents'>} permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
