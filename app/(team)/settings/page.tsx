import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { settingsSectionsFor } from '@/lib/settings-sections';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsIndex() {
  const viewer = await getViewer();
  const firstBuilt = settingsSectionsFor(viewer?.permissions ?? []).find((section) => section.built);
  if (firstBuilt) redirect(firstBuilt.href);
  return <p className="text-muted-foreground">There are no settings you can change yet.</p>;
}
