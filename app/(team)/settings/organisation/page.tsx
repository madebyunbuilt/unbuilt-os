import type { Metadata } from 'next';
import { OrganisationForm } from '@/components/settings/organisation-form';
import { SettingsPage } from '@/components/settings/settings-page';

export const metadata: Metadata = { title: 'Organisation settings' };

export default function OrganisationSettingsPage() {
  return (
    <SettingsPage
      title="Organisation"
      description="How the studio appears on invoices, quotes and contracts."
      permission="settings.manage"
    >
      <OrganisationForm />
    </SettingsPage>
  );
}
