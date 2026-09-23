import type { Metadata } from 'next';
import { FxRates } from '@/components/settings/fx-rates';
import { SettingsPage } from '@/components/settings/settings-page';

export const metadata: Metadata = { title: 'Exchange rates' };

export default function ExchangeRatesPage() {
  return (
    <SettingsPage
      title="Exchange rates"
      description="Naira per dollar and per euro. A USD or EUR invoice needs a rate from the last 7 days before it can be sent."
      permission="fx.manage"
    >
      <FxRates />
    </SettingsPage>
  );
}
