'use client';

import { useMutation } from 'convex/react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { formatDateRange } from '@/convex/lib/timeOffFormat';

// Pieces shared by the time off page and the leave calendar.

export type TimeOffEntry = (typeof api.timeOff.pending._returnType)[number];

export function describeDays(entry: Pick<TimeOffEntry, 'days' | 'halfDay'>): string {
  if (entry.halfDay) return 'Half day';
  return `${entry.days} working ${entry.days === 1 ? 'day' : 'days'}`;
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function CancelTimeOff({ entry, label = 'Cancel' }: { entry: TimeOffEntry; label?: string }) {
  const cancel = useMutation(api.timeOff.cancel);
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          {label}
        </Button>
      }
      title="Cancel this time off?"
      description={`${entry.memberName}, ${formatDateRange(entry.startDate, entry.endDate)}. ${
        entry.status === 'approved'
          ? 'It no longer counts as time off, and they are told.'
          : 'The request is withdrawn.'
      }`}
      confirmLabel="Cancel time off"
      onConfirm={() => cancel({ timeOffId: entry.id })}
    />
  );
}
