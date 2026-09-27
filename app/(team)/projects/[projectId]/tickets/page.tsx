import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ProjectTickets } from '@/components/support/scoped-tickets';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Project tickets' };

export default async function ProjectTicketsPage({ params }: PageProps<'/projects/[projectId]/tickets'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['tickets.view.all', 'tickets.view.assigned']} what="tickets">
      <ProjectTickets projectId={projectId as Id<'projects'>} />
    </RequirePermission>
  );
}
