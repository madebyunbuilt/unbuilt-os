import type { Metadata } from 'next';
import { DocumentList } from '@/components/documents/document-list';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Project documents' };

export default async function ProjectDocumentsPage({ params }: PageProps<'/projects/[projectId]/documents'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <DocumentList permissions={permissions} projectId={projectId as Id<'projects'>} heading="Documents" />;
}
