import type { Metadata } from 'next';
import { SettingsPage } from '@/components/settings/settings-page';
import { SignatureProcessReview } from '@/components/settings/signature-process-review';
import { TemplateList } from '@/components/settings/template-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Document templates' };

export default async function DocumentTemplatesPage() {
  // Only the Owner holds owner.transfer; the server checks the role itself before recording anything.
  const isOwner = (await getViewer())?.permissions.includes('owner.transfer') ?? false;
  return (
    <SettingsPage
      title="Document templates"
      description="What each type of document starts from. Editing one makes a new version; documents already made keep theirs."
      permission="templates.documents.manage"
    >
      <div className="space-y-8">
        <SignatureProcessReview isOwner={isOwner} />
        <TemplateList />
      </div>
    </SettingsPage>
  );
}
