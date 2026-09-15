'use client';

import { useMutation, useQuery } from 'convex/react';
import { CalendarPlus, ClipboardPen } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { LeaveCalendar } from '@/components/team/time-off/leave-calendar';
import { CancelTimeOff, describeDays, Section, type TimeOffEntry } from '@/components/team/time-off/time-off-parts';
import { TimeOffDialog } from '@/components/team/time-off/time-off-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { formatDateRange, TYPE_LABELS } from '@/convex/lib/timeOffFormat';
import { errorMessage } from '@/lib/convex-error';
import { timeOffStatus } from '@/lib/time-off-display';

/** The time off page: decisions waiting for you, the team calendar and your own time off. */
export function TimeOffOverview({ permissions }: { permissions: string[] }) {
  const canRequest = permissions.includes('timeoff.request');
  const canApprove = permissions.includes('timeoff.approve');
  const canViewTeam = permissions.includes('team.view');

  const mine = useQuery(api.timeOff.mine, canRequest ? {} : 'skip');
  const pending = useQuery(api.timeOff.pending, canApprove ? {} : 'skip');
  const me = useQuery(api.team.me);
  const team = useQuery(api.team.list, canApprove && canViewTeam ? {} : 'skip');
  const today = mine?.today ?? new Date().toISOString().slice(0, 10);

  // Approvers record time off for others; only the Owner may record their own.
  const recordable = team
    ?.filter((member) => member.status === 'active' && (member.id !== me?.id || me?.role?.isOwner))
    .map((member) => ({ id: member.id, name: member.name }));

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold">Time off</h1>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {recordable && (
            <TimeOffDialog
              today={today}
              members={recordable}
              trigger={
                <Button variant="outline">
                  <ClipboardPen aria-hidden />
                  Record for someone
                </Button>
              }
            />
          )}
          {canRequest && (
            <TimeOffDialog
              today={today}
              trigger={
                <Button>
                  <CalendarPlus aria-hidden />
                  Request time off
                </Button>
              }
            />
          )}
        </div>
      </header>

      {canApprove && (
        <Section id="pending-heading" title="Waiting for a decision">
          {pending === undefined ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : pending.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-muted-foreground">No requests are waiting.</p>
          ) : (
            <ul className="space-y-3">
              {pending.map((entry) => (
                <PendingRequest key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </Section>
      )}

      {canViewTeam && (
        <Section id="calendar-heading" title="Team calendar">
          <LeaveCalendar today={today} />
        </Section>
      )}

      {canRequest && (
        <Section id="mine-heading" title="Your time off">
          {mine === undefined ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : mine.requests.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-muted-foreground">You have no time off yet.</p>
          ) : (
            <MyTimeOff entries={mine.requests} />
          )}
        </Section>
      )}

      {mine && mine.upcomingHolidays.length > 0 && (
        <Section id="holidays-heading" title="Public holidays">
          <ul className="divide-y rounded-lg border text-sm">
            {mine.upcomingHolidays.map((holiday) => (
              <li
                key={`${holiday.date}-${holiday.name}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="w-32 shrink-0 text-muted-foreground">
                  {formatDateRange(holiday.date, holiday.date)}
                </span>
                <span className="font-medium">{holiday.name}</span>
                {holiday.needsConfirmation && <ToneBadge label="Estimated date" tone="draft" />}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function PendingRequest({ entry }: { entry: TimeOffEntry }) {
  const approve = useMutation(api.timeOff.approve);
  const decline = useMutation(api.timeOff.decline);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-medium">{entry.memberName}</p>
        <p className="text-sm text-muted-foreground">
          {entry.type ? TYPE_LABELS[entry.type] : 'Time off'} · {formatDateRange(entry.startDate, entry.endDate)} ·{' '}
          {describeDays(entry)}
        </p>
      </div>
      {entry.note && <p className="mt-2 text-sm">“{entry.note}”</p>}
      {entry.canDecide ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={async () => {
              setError(null);
              try {
                await approve({ timeOffId: entry.id });
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          >
            Approve
          </Button>
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="outline">
                Decline
              </Button>
            }
            title={`Decline ${entry.memberName}’s request?`}
            description={`${formatDateRange(entry.startDate, entry.endDate)}. They are told, with your note if you add one.`}
            confirmLabel="Decline"
            onConfirm={() => decline({ timeOffId: entry.id, note: note || undefined })}
          >
            <div className="space-y-2">
              <Label htmlFor={`decline-note-${entry.id}`}>Note (optional)</Label>
              <Textarea
                id={`decline-note-${entry.id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </ConfirmDialog>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">This is your own request, so someone else decides it.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

function MyTimeOff({ entries }: { entries: TimeOffEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-160 text-sm">
        <caption className="sr-only">Your time off</caption>
        <thead className="bg-muted text-left">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Dates
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Type
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t align-top">
              <td className="px-4 py-3">
                <span className="block font-medium">{formatDateRange(entry.startDate, entry.endDate)}</span>
                <span className="block text-muted-foreground">{describeDays(entry)}</span>
              </td>
              <td className="px-4 py-3">
                <span className="block">{entry.type ? TYPE_LABELS[entry.type] : 'Time off'}</span>
                {entry.note && <span className="block text-muted-foreground">{entry.note}</span>}
              </td>
              <td className="px-4 py-3">
                <ToneBadge {...timeOffStatus(entry.status)} />
                {entry.enteredByName && (
                  <span className="mt-1 block text-muted-foreground">Recorded by {entry.enteredByName}</span>
                )}
                {entry.decidedByName &&
                  (entry.status === 'approved' || entry.status === 'declined') &&
                  !entry.enteredByName && (
                    <span className="mt-1 block text-muted-foreground">
                      {timeOffStatus(entry.status).label} by {entry.decidedByName}
                    </span>
                  )}
                {entry.decisionNote && <span className="mt-1 block">“{entry.decisionNote}”</span>}
              </td>
              <td className="px-4 py-3 text-right">{entry.canCancel && <CancelTimeOff entry={entry} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
