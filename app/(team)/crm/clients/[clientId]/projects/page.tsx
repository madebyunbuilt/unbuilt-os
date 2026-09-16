import type { Metadata } from 'next';
import { ClientProjects } from '@/components/crm/client-projects';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client projects' };

export default async function ClientProjectsPage({ params }: PageProps<'/crm/clients/[clientId]/projects'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ClientProjects clientId={clientId as Id<'clients'>} permissions={permissions} />;
}
