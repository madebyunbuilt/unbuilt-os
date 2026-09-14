import type { Metadata } from 'next';
import { BillingForm } from '@/components/settings/billing-form';
import { SettingsPage } from '@/components/settings/settings-page';

export const metadata: Metadata = { title: 'Billing settings' };

export default function BillingSettingsPage() {
  return (
    <SettingsPage
      title="Billing"
      description="Defaults for new invoices and quotes, the accounts clients pay into, and document numbers."
      permission="settings.billing.sensitive"
    >
      <BillingForm />
    </SettingsPage>
  );
}
