import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ClientList } from '@/components/crm/client-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['clients.view']} what="clients">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Clients</h1>
        <ClientList
          canCreate={permissions.includes('clients.create')}
          canViewTeam={permissions.includes('team.view')}
        />
      </div>
    </RequirePermission>
  );
}
