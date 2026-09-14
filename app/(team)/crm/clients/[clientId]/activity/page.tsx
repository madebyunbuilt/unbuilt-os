import type { Metadata } from 'next';
import { Timeline } from '@/components/crm/timeline';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Client activity' };

export default async function ClientActivityPage({ params }: PageProps<'/crm/clients/[clientId]/activity'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <div className="max-w-3xl">
      <Timeline
        subject={{ table: 'clients', id: clientId }}
        canAdd={permissions.includes('clients.view')}
        canMention={permissions.includes('team.view')}
      />
    </div>
  );
}
