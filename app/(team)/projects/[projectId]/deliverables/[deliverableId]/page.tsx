import type { Metadata } from 'next';
import { DeliverableDetail } from '@/components/projects/deliverable-detail';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Deliverable' };

export default async function DeliverablePage({
  params,
}: PageProps<'/projects/[projectId]/deliverables/[deliverableId]'>) {
  const { deliverableId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <DeliverableDetail deliverableId={deliverableId as Id<'deliverables'>} permissions={permissions} />;
}
