import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ServiceEditor } from '@/components/cms/service-editor';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Service page' };

export default async function ServicePage({ params }: PageProps<'/cms/services/[servicePageId]'>) {
  const { servicePageId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.edit']} what="the website">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <ServiceEditor servicePageId={servicePageId as Id<'servicePages'>} />
      </div>
    </RequirePermission>
  );
}
