'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { formatDay } from '@/lib/crm-display';
import { formatDuration, timeEntryStatus, weekLabel } from '@/lib/time-display';

// Approving time (06-projects.md, Time approval). Only weeks the caller may decide are listed: nobody approves their
// own time except the Owner, and project managers decide on the projects they manage.

type Week = (typeof api.time.pendingApprovals._returnType)[number];

export function TimeApprovals({ permissions }: { permissions: string[] }) {
  const weeks = useQuery(api.time.pendingApprovals, {});
  const outstanding = useQuery(api.time.outstandingWeeks, permissions.includes('time.view.all') ? {} : 'skip');
  const [reviewing, setReviewing] = useState<Week | null>(null);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Waiting for you</h2>
        {weeks === undefined ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : weeks.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">
            No weeks are waiting on your decision.
          </p>
        ) : (
          <ul className="space-y-2">
            {weeks.map((week) => (
              <li
                key={`${week.memberId}:${week.weekStart}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{week.memberName}</p>
                  <p className="text-sm text-muted-foreground">{weekLabel(week.weekStart)}</p>
                </div>
                <p className="text-sm tabular-nums sm:ml-auto">
                  {formatDuration(week.minutes)} · {week.entries} {week.entries === 1 ? 'entry' : 'entries'}
                </p>
                <Button variant="outline" size="sm" onClick={() => setReviewing(week)}>
                  Look through it
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {outstanding !== undefined && outstanding.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl font-bold">Not submitted yet</h2>
          <p className="text-sm text-muted-foreground">Past weeks still sitting in someone&rsquo;s drafts.</p>
          <ul className="space-y-2">
            {outstanding.map((week) => (
              <li
                key={`${week.memberId}:${week.weekStart}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{week.memberName}</p>
                  <p className="text-sm text-muted-foreground">{weekLabel(week.weekStart)}</p>
                </div>
                <p className="text-sm tabular-nums sm:ml-auto">{formatDuration(week.minutes)} in drafts</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reviewing && <WeekReview week={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}

function WeekReview({ week, onClose }: { week: Week; onClose: () => void }) {
  const entries = useQuery(api.time.weekForReview, { memberId: week.memberId, weekStart: week.weekStart });
  const approve = useMutation(api.time.approve);
  const returnEntries = useMutation(api.time.returnEntries);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [note, setNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const decidable = (entries ?? []).filter((entry) => entry.canDecide);
  // Everything decidable is chosen until the approver picks out particular entries.
  const selected = chosen ?? new Set(decidable.map((entry) => entry.id));
  const ids = decidable.filter((entry) => selected.has(entry.id)).map((entry) => entry.id as Id<'timeEntries'>);

  const decide = async (action: 'approve' | 'return') => {
    if (ids.length === 0) {
      setError('Choose at least one entry');
      return;
    }
    if (action === 'return' && !note.trim()) {
      setReturning(true);
      setError('Say what needs changing');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (action === 'approve') await approve({ entryIds: ids });
      else await returnEntries({ entryIds: ids, note });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {week.memberName}, {weekLabel(week.weekStart)}
          </DialogTitle>
          <DialogDescription>
            Approve what is right, or send entries back with a note saying what to change.
          </DialogDescription>
        </DialogHeader>

        {entries === undefined ? (
          <p className="text-muted-foreground">Loading the week…</p>
        ) : (
          <ul className="space-y-2" aria-label="Entries in this week">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start gap-3 rounded-md border p-3">
                {entry.canDecide ? (
                  <Checkbox
                    id={`decide-${entry.id}`}
                    className="mt-1"
                    checked={selected.has(entry.id)}
                    onCheckedChange={(checked) =>
                      setChosen(() => {
                        const next = new Set(selected);
                        if (checked === true) next.add(entry.id);
                        else next.delete(entry.id);
                        return next;
                      })
                    }
                  />
                ) : (
                  <span className="mt-1 size-4" />
                )}
                <div className="min-w-0">
                  <Label htmlFor={`decide-${entry.id}`} className="font-medium">
                    {entry.projectCode} {entry.projectName}
                    {entry.taskTitle && <span className="text-muted-foreground"> · {entry.taskTitle}</span>}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {formatDay(entry.date)} · {entry.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <span className="tabular-nums">{formatDuration(entry.minutes)}</span>
                  {!entry.billable && <span className="text-sm text-muted-foreground">Not billable</span>}
                  <ToneBadge {...timeEntryStatus(entry.status)} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {returning && (
          <div className="space-y-2">
            <Label htmlFor="return-note">What needs changing</Label>
            <Textarea id="return-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" disabled={saving} onClick={() => void decide('return')}>
            {returning ? 'Send back' : 'Send back with a note'}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void decide('approve')}>
            {saving ? 'Saving…' : `Approve ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
