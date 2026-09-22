import type { Metadata } from 'next';
import { SettingsPage } from '@/components/settings/settings-page';
import { TemplateList } from '@/components/settings/template-list';

export const metadata: Metadata = { title: 'Document templates' };

export default function DocumentTemplatesPage() {
  return (
    <SettingsPage
      title="Document templates"
      description="What each type of document starts from. Editing one makes a new version; documents already made keep theirs."
      permission="templates.documents.manage"
    >
      <TemplateList />
    </SettingsPage>
  );
}
