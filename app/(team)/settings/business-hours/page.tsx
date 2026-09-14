import type { Metadata } from 'next';
import { BusinessHoursForm } from '@/components/settings/business-hours-form';
import { HolidaysList } from '@/components/settings/holidays-list';
import { SettingsPage } from '@/components/settings/settings-page';

export const metadata: Metadata = { title: 'Business hours and holidays' };

export default function BusinessHoursSettingsPage() {
  return (
    <SettingsPage
      title="Business hours and holidays"
      description="SLA timers count only working hours, and time off skips closed days and public holidays."
      permission={['settings.manage', 'sla.manage']}
    >
      <div className="space-y-12">
        <section aria-labelledby="hours-heading" className="space-y-4">
          <h3 id="hours-heading" className="font-display text-xl font-bold">
            Business hours
          </h3>
          <BusinessHoursForm />
        </section>
        <section aria-labelledby="holidays-heading" className="space-y-4">
          <h3 id="holidays-heading" className="font-display text-xl font-bold">
            Public holidays
          </h3>
          <HolidaysList />
        </section>
      </div>
    </SettingsPage>
  );
}
