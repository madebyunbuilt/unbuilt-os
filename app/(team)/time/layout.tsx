import { RequirePermission } from '@/components/app/require-permission';
import { TimeTabs } from '@/components/time/time-tabs';
import { getViewer } from '@/lib/viewer';

export default async function TimeLayout({ children }: LayoutProps<'/time'>) {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['time.log.own', 'time.approve']} what="time">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="font-display text-3xl font-bold">Time</h1>
        <TimeTabs canApprove={permissions.includes('time.approve')} />
        {children}
      </div>
    </RequirePermission>
  );
}
