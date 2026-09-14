import { RequirePermission } from '@/components/app/require-permission';
import { ClientHeader } from '@/components/crm/client-header';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export default async function ClientLayout({ children, params }: LayoutProps<'/crm/clients/[clientId]'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['clients.view']} what="clients">
      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
        <ClientHeader clientId={clientId as Id<'clients'>} permissions={permissions} />
        {children}
      </div>
    </RequirePermission>
  );
}
