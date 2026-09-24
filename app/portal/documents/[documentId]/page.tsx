import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalDocument } from '@/components/portal/portal-documents';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Document' };

export default async function PortalDocumentPage({ params }: PageProps<'/portal/documents/[documentId]'>) {
  const { documentId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.documents.view']} what="documents">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <PortalDocument documentId={documentId as Id<'documents'>} />
      </div>
    </RequirePermission>
  );
}
