import type { Metadata } from 'next';
import { ClauseLibrary } from '@/components/settings/clause-library';
import { SettingsPage } from '@/components/settings/settings-page';

export const metadata: Metadata = { title: 'Clauses' };

export default function ClausesPage() {
  return (
    <SettingsPage
      title="Clauses"
      description="Wording templates share. Changing a clause raises its version; documents already made keep the wording they copied in."
      permission="templates.documents.manage"
    >
      <ClauseLibrary />
    </SettingsPage>
  );
}
