import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PortalColleagues } from '@/components/portal/portal-colleagues';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Colleagues' };

export default async function PortalColleaguesPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['portal.colleagues.manage']} what="colleagues">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-6 font-display text-3xl font-bold">Colleagues</h1>
        <PortalColleagues />
      </div>
    </RequirePermission>
  );
}
