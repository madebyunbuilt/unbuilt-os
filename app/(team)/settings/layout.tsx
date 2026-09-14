import { SettingsNav } from '@/components/settings/settings-nav';
import { settingsSectionsFor } from '@/lib/settings-sections';
import { getViewer } from '@/lib/viewer';

export default async function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  const viewer = await getViewer();
  const sections = settingsSectionsFor(viewer?.permissions ?? []);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <h1 className="font-display text-3xl font-bold">Settings</h1>
      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <aside className="lg:w-60 lg:shrink-0">
          <SettingsNav sections={sections} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
