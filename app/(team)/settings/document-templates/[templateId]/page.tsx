import type { Metadata } from 'next';
import { SettingsPage } from '@/components/settings/settings-page';
import { TemplateEditorLoader } from '@/components/settings/template-editor-loader';
import { type Id } from '@/convex/_generated/dataModel';

export const metadata: Metadata = { title: 'Edit template' };

export default async function EditTemplatePage({ params }: PageProps<'/settings/document-templates/[templateId]'>) {
  const { templateId } = await params;
  return (
    <SettingsPage
      title="Edit template"
      description="Saving a change makes a new version. Documents already made keep the version they came from."
      permission="templates.documents.manage"
    >
      <TemplateEditorLoader templateId={templateId as Id<'documentTemplates'>} />
    </SettingsPage>
  );
}
