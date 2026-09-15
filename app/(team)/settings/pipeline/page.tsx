import type { Metadata } from 'next';
import { PipelineSettings } from '@/components/settings/pipeline-settings';
import { SettingsPage } from '@/components/settings/settings-page';

export const metadata: Metadata = { title: 'Pipeline settings' };

export default function PipelineSettingsPage() {
  return (
    <SettingsPage
      title="Pipeline"
      description="The stages deals move through, their default chance to win, and why deals are lost."
      permission="deals.manage"
    >
      <PipelineSettings />
    </SettingsPage>
  );
}
