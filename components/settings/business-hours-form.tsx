'use client';

import { useMutation, useQuery } from 'convex/react';
import { useMemo, useState } from 'react';
import { SaveStatus } from '@/components/settings/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { errorMessage } from '@/lib/convex-error';

/** Monday first, as the studio reads a week. Values match business hours: 0 = Sunday. */
export const WEEK = [
  { day: 1, label: 'Monday' },
  { day: 2, label: 'Tuesday' },
  { day: 3, label: 'Wednesday' },
  { day: 4, label: 'Thursday' },
  { day: 5, label: 'Friday' },
  { day: 6, label: 'Saturday' },
  { day: 0, label: 'Sunday' },
] as const;

type DayHours = { open: boolean; start: string; end: string };
type Hours = NonNullable<typeof api.businessHours.get._returnType>;

export function toWeekly(days: Record<number, DayHours>) {
  return WEEK.filter(({ day }) => days[day].open).map(({ day }) => ({
    day,
    start: days[day].start,
    end: days[day].end,
  }));
}

export function BusinessHoursForm() {
  const hours = useQuery(api.businessHours.get);
  if (!hours) return <p className="text-muted-foreground">Loading…</p>;
  return <HoursForm key={JSON.stringify(hours)} hours={hours} />;
}

function HoursForm({ hours }: { hours: Hours }) {
  const update = useMutation(api.businessHours.update);
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const [name, setName] = useState(hours.name);
  const [timezone, setTimezone] = useState(hours.timezone);
  const [days, setDays] = useState<Record<number, DayHours>>(() =>
    Object.fromEntries(
      WEEK.map(({ day }) => {
        const windows = hours.weekly.filter((w) => w.day === day);
        return [
          day,
          windows.length
            ? { open: true, start: windows[0].start, end: windows.at(-1)!.end }
            : { open: false, start: '09:00', end: '17:00' },
        ];
      }),
    ),
  );
  const splitDays = WEEK.filter(({ day }) => hours.weekly.filter((w) => w.day === day).length > 1);
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });
  const disabled = !hours.canEdit;
  const setDay = (day: number, change: Partial<DayHours>) =>
    setDays((current) => ({ ...current, [day]: { ...current[day], ...change } }));

  async function save() {
    setStatus({ kind: 'idle' });
    try {
      await update({ name, timezone, weekly: toWeekly(days) });
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="hours-name">Name</Label>
          <Input id="hours-name" value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hours-timezone">Timezone</Label>
          <NativeSelect
            id="hours-timezone"
            value={timezone}
            disabled={disabled}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-medium">Working hours</legend>
        {WEEK.map(({ day, label }) => {
          const hoursForDay = days[day];
          return (
            <div key={day} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex w-32 items-center gap-2">
                <Checkbox
                  id={`hours-open-${day}`}
                  checked={hoursForDay.open}
                  disabled={disabled}
                  onCheckedChange={(checked) => setDay(day, { open: checked === true })}
                />
                <Label htmlFor={`hours-open-${day}`} className="font-normal">
                  {label}
                </Label>
              </div>
              {hoursForDay.open ? (
                <div className="flex items-center gap-2">
                  <Label htmlFor={`hours-start-${day}`} className="sr-only">
                    {label} opens
                  </Label>
                  <Input
                    id={`hours-start-${day}`}
                    type="time"
                    className="w-32"
                    value={hoursForDay.start}
                    disabled={disabled}
                    onChange={(event) => setDay(day, { start: event.target.value })}
                  />
                  <span aria-hidden>to</span>
                  <Label htmlFor={`hours-end-${day}`} className="sr-only">
                    {label} closes
                  </Label>
                  <Input
                    id={`hours-end-${day}`}
                    type="time"
                    className="w-32"
                    value={hoursForDay.end}
                    disabled={disabled}
                    onChange={(event) => setDay(day, { end: event.target.value })}
                  />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Closed</span>
              )}
            </div>
          );
        })}
      </fieldset>
      {splitDays.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {splitDays.map((d) => d.label).join(', ')} currently {splitDays.length === 1 ? 'has' : 'have'} split hours.
          Saving here keeps one window per day, from the first opening to the last closing.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        SLA due times count only these hours, and time off counts only open days.
      </p>

      {hours.canEdit ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={() => void save()}>Save hours</Button>
          <SaveStatus state={status} />
        </div>
      ) : (
        <p className="rounded-md border p-4 text-sm">Only the Owner and Admins can change business hours.</p>
      )}
    </div>
  );
}
