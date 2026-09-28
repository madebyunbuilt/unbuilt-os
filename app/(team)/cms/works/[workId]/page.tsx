import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { WorkEditor } from '@/components/cms/work-editor';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Case study' };

export default async function WorkPage({ params }: PageProps<'/cms/works/[workId]'>) {
  const { workId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.edit']} what="the website">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <WorkEditor workId={workId as Id<'works'>} />
      </div>
    </RequirePermission>
  );
}
