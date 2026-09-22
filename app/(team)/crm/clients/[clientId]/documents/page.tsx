import type { Metadata } from 'next';
import { DocumentList } from '@/components/documents/document-list';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client documents' };

export default async function ClientDocumentsPage({ params }: PageProps<'/crm/clients/[clientId]/documents'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <DocumentList permissions={permissions} clientId={clientId as Id<'clients'>} heading="Documents" />;
}
