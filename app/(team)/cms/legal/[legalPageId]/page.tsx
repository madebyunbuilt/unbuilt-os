import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { LegalEditor } from '@/components/cms/legal-editor';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Legal page' };

export default async function LegalPage({ params }: PageProps<'/cms/legal/[legalPageId]'>) {
  const { legalPageId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.edit']} what="the website">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <LegalEditor legalPageId={legalPageId as Id<'legalPages'>} />
      </div>
    </RequirePermission>
  );
}
