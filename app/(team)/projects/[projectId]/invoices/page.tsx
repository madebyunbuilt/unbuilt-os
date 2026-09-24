import type { Metadata } from 'next';
import { ProjectBillingPanel } from '@/components/projects/project-billing-panel';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Invoices' };

export default async function ProjectInvoicesPage({ params }: PageProps<'/projects/[projectId]/invoices'>) {
  const { projectId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ProjectBillingPanel projectId={projectId as Id<'projects'>} permissions={permissions} />;
}
