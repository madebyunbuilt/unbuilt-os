'use client';

import { useMutation, useQuery } from 'convex/react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { EntryFormDialog } from '@/components/time/entry-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { addDays } from '@/convex/lib/timeOffFormat';
import { errorMessage } from '@/lib/convex-error';
import { formatDay } from '@/lib/crm-display';
import { formatDuration, timeEntryStatus, weekDays, weekLabel, weekdayName, weekStartOf } from '@/lib/time-display';

// Your week (06-projects.md, Weekly submission). Drafts are yours to change; submitting sends the week's drafts for
// approval, and a returned entry comes back as a draft with a note.

type Entry = (typeof api.time.myWeek._returnType)['entries'][number];

export function Timesheet() {
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const week = useQuery(api.time.myWeek, weekStart ? { weekStart } : {});
  const submit = useMutation(api.time.submitWeek);
  const remove = useMutation(api.time.remove);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (week === undefined) return <p className="text-muted-foreground">Loading your week…</p>;

  const days = weekDays(week.weekStart);
  const thisWeek = weekStartOf(week.today);
  const returned = week.entries.filter((entry) => entry.returnedNote !== undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="The week before"
            onClick={() => setWeekStart(addDays(week.weekStart, -7))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="The week after"
            onClick={() => setWeekStart(addDays(week.weekStart, 7))}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <div>
          <p className="font-medium">{weekLabel(week.weekStart)}</p>
          <p className="text-sm text-muted-foreground">
            {formatDuration(week.totals.minutes)} logged · {formatDuration(week.totals.billableMinutes)} billable
          </p>
        </div>
        {week.weekStart !== thisWeek && (
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(thisWeek)}>
            This week
          </Button>
        )}
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <EntryFormDialog
            date={
              week.weekStart <= week.today && week.today <= addDays(week.weekStart, 6) ? week.today : week.weekStart
            }
            trigger={
              <Button>
                <Plus aria-hidden />
                Log time
              </Button>
            }
          />
          {week.totals.draft > 0 && (
            <Button
              variant="outline"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                setError(null);
                try {
                  await submit({ weekStart: week.weekStart });
                } catch (caught) {
                  setError(errorMessage(caught));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting
                ? 'Submitting…'
                : `Submit ${week.totals.draft} ${week.totals.draft === 1 ? 'entry' : 'entries'}`}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
          {error}
        </p>
      )}

      {returned.length > 0 && (
        <div className="rounded-md border border-attention bg-attention/10 p-4">
          <h2 className="font-medium">Sent back to you</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {returned.map((entry) => (
              <li key={entry.id}>
                {formatDay(entry.date)} · {entry.projectName}: {entry.returnedNote}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="space-y-4" aria-label="The week's days">
        {days.map((day) => {
          const entries = week.entries.filter((entry) => entry.date === day);
          const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
          return (
            <li key={day} className="rounded-lg border p-4" aria-label={weekdayName(day)}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="font-medium">
                  {weekdayName(day)} {day === week.today && <span className="text-muted-foreground">· today</span>}
                </h2>
                <p className="text-sm text-muted-foreground">{formatDay(day)}</p>
                <p className="text-sm tabular-nums sm:ml-auto">
                  {minutes === 0 ? 'Nothing yet' : formatDuration(minutes)}
                </p>
              </div>
              {entries.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {entries.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {entry.projectCode} {entry.projectName}
                          {entry.taskTitle && <span className="text-muted-foreground"> · {entry.taskTitle}</span>}
                        </p>
                        <p className="text-sm text-muted-foreground">{entry.description}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                        <span className="tabular-nums">{formatDuration(entry.minutes)}</span>
                        {!entry.billable && <span className="text-sm text-muted-foreground">Not billable</span>}
                        <ToneBadge {...timeEntryStatus(entry.status)} />
                        {entry.canEdit && <EntryActions entry={entry} onRemove={() => remove({ entryId: entry.id })} />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <EntryFormDialog
                  date={day}
                  trigger={
                    <Button variant="ghost" size="sm">
                      <Plus aria-hidden />
                      Add to {weekdayName(day)}
                    </Button>
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EntryActions({ entry, onRemove }: { entry: Entry; onRemove: () => Promise<unknown> }) {
  return (
    <>
      <EntryFormDialog
        entry={entry}
        trigger={
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        }
      />
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm">
            Delete
          </Button>
        }
        title="Delete this entry?"
        description={`${formatDuration(entry.minutes)} on ${entry.projectName}. The audit log keeps a record.`}
        confirmLabel="Delete"
        onConfirm={onRemove}
      />
    </>
  );
}
