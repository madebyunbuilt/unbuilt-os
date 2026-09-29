import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { PostEditor } from '@/components/cms/post-editor';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Insight' };

export default async function InsightPage({ params }: PageProps<'/cms/insights/[postId]'>) {
  const { postId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.edit']} what="the website">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <PostEditor postId={postId as Id<'posts'>} />
      </div>
    </RequirePermission>
  );
}
