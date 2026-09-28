import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ContentList } from '@/components/cms/content-list';
import { NewContent } from '@/components/cms/new-content';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Service pages' };

export default async function ServicesPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.view']} what="the website">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Service pages</h1>
            <p className="text-muted-foreground">One landing page per service.</p>
          </div>
          {permissions.includes('cms.edit') && <NewContent table="servicePages" />}
        </div>
        <ContentList table="servicePages" />
      </div>
    </RequirePermission>
  );
}
