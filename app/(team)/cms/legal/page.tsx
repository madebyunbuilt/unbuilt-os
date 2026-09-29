import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ContentList } from '@/components/cms/content-list';
import { NewContent } from '@/components/cms/new-content';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Legal pages' };

export default async function LegalPagesPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.view']} what="the website">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Legal pages</h1>
            <p className="text-muted-foreground">Privacy, terms, and what the portal asks clients to accept.</p>
          </div>
          {permissions.includes('cms.edit') && <NewContent table="legalPages" />}
        </div>
        <ContentList table="legalPages" />
      </div>
    </RequirePermission>
  );
}
