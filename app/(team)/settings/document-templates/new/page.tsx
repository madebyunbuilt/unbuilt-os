import type { Metadata } from 'next';
import { SettingsPage } from '@/components/settings/settings-page';
import { TemplateEditor } from '@/components/settings/template-editor';

export const metadata: Metadata = { title: 'New template' };

export default function NewTemplatePage() {
  return (
    <SettingsPage
      title="New template"
      description="Choose the type, then build the document from blocks."
      permission="templates.documents.manage"
    >
      <TemplateEditor />
    </SettingsPage>
  );
}
