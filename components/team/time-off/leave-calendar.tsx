'use client';

import { useQuery } from 'convex/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ToneBadge } from '@/components/team/status-badge';
import { CancelTimeOff, describeDays, type TimeOffEntry } from '@/components/team/time-off/time-off-parts';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { formatDateRange, TYPE_LABELS } from '@/convex/lib/timeOffFormat';
import {
  monthBounds,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  timeOffStatus,
  WEEKDAY_LABELS,
  weekdayOf,
} from '@/lib/time-off-display';
import { cn } from '@/lib/utils';

/**
 * Who is off each day of a month, with public holidays. Pending requests appear only for approvers (and your own),
 * outlined in the "not built yet" blue; the reason appears only where the query returned it.
 */
export function LeaveCalendar({ today }: { today: string }) {
  const [month, setMonth] = useState(() => monthOf(today));
  const weeks = monthGrid(month);
  const from = weeks[0][0];
  const to = weeks.at(-1)!.at(-1)!;
  const data = useQuery(api.timeOff.calendar, { from, to });
  const inMonth = (date: string) => monthOf(date).month === month.month;

  const holidaysOn = (date: string) => data?.holidays.filter((holiday) => holiday.date === date) ?? [];
  const offOn = (date: string) =>
    data?.entries.filter((entry) => entry.startDate <= date && date <= entry.endDate) ?? [];
  const { first, last } = monthBounds(month);
  const monthEntries = data?.entries.filter((entry) => entry.endDate >= first && entry.startDate <= last) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous month"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <p aria-live="polite" className="min-w-40 text-center font-medium">
          {monthLabel(month)}
        </p>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setMonth(monthOf(today))}>
          Today
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[44rem] table-fixed text-sm">
          <caption className="sr-only">Team time off, {monthLabel(month)}</caption>
          <thead className="bg-muted">
            <tr>
              {WEEKDAY_LABELS.map((label) => (
                <th key={label} scope="col" className="px-2 py-2 text-left font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]} className="border-t">
                {week.map((date) => {
                  const working = data?.workingWeekdays.includes(weekdayOf(date)) ?? weekdayOf(date) % 6 !== 0;
                  const holidays = holidaysOn(date);
                  const off = offOn(date);
                  return (
                    <td
                      key={date}
                      aria-current={date === today ? 'date' : undefined}
                      className={cn(
                        'h-24 border-l px-1.5 py-1 align-top first:border-l-0',
                        (!working || holidays.length > 0) && 'bg-muted/60',
                        !inMonth(date) && 'text-muted-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex size-6 items-center justify-center rounded-full text-xs',
                          date === today && 'bg-primary font-bold text-primary-foreground',
                        )}
                      >
                        {Number(date.slice(8))}
                      </span>
                      {holidays.map((holiday) => (
                        <p key={holiday.name} className="truncate text-xs font-medium" title={holiday.name}>
                          {holiday.name}
                          {holiday.needsConfirmation && <span className="sr-only"> (estimated date)</span>}
                        </p>
                      ))}
                      {working && holidays.length === 0 && (
                        <ul className="mt-0.5 space-y-0.5">
                          {off.map((entry) => (
                            <li
                              key={entry.id}
                              title={entry.type ? TYPE_LABELS[entry.type] : undefined}
                              className={cn(
                                'truncate rounded px-1 text-xs',
                                entry.status === 'requested'
                                  ? 'border border-dashed border-draft text-draft'
                                  : 'bg-foreground/10',
                              )}
                            >
                              {entry.memberName}
                              {entry.halfDay && ' (½)'}
                              {entry.status === 'requested' && <span className="sr-only"> (pending)</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : monthEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is off in {monthLabel(month)}.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm" aria-label={`Time off in ${monthLabel(month)}`}>
          {monthEntries.map((entry) => (
            <CalendarEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CalendarEntry({ entry }: { entry: TimeOffEntry }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <span className="font-medium">{entry.memberName}</span>
      <span className="text-muted-foreground">
        {formatDateRange(entry.startDate, entry.endDate)} · {describeDays(entry)}
        {entry.type && ` · ${TYPE_LABELS[entry.type]}`}
      </span>
      {entry.status === 'requested' && <ToneBadge {...timeOffStatus(entry.status)} />}
      {entry.canCancel && (
        <span className="ml-auto">
          <CancelTimeOff entry={entry} />
        </span>
      )}
    </li>
  );
}
