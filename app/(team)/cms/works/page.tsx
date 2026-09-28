import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ContentList } from '@/components/cms/content-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Case studies' };

export default async function WorksPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.view']} what="the website">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Case studies</h1>
          <p className="text-muted-foreground">Drafted from a project when its handover is done, then written here.</p>
        </div>
        <ContentList table="works" />
      </div>
    </RequirePermission>
  );
}
