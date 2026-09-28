import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { SettingsEditor } from '@/components/cms/settings-editor';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Site settings' };

export default async function SiteSettingsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.view']} what="the website">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Site settings</h1>
          <p className="text-muted-foreground">
            The website&rsquo;s own details, and how long publishing waits before it rebuilds.
          </p>
        </div>
        <SettingsEditor canManage={permissions.includes('cms.settings.manage')} />
      </div>
    </RequirePermission>
  );
}
