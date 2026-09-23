import type { Metadata } from 'next';
import { NotificationsPage } from '@/components/app/notifications-page';

export const metadata: Metadata = { title: 'Notifications' };

export default function TeamNotificationsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <NotificationsPage surface="team" />
    </div>
  );
}
