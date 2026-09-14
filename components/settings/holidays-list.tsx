'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatDateRange } from '@/convex/lib/timeOffFormat';
import { errorMessage } from '@/lib/convex-error';

type Holiday = (typeof api.holidays.list._returnType)['holidays'][number];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

/** Public holidays for a year: confirm estimated dates, add declared days, remove days added by hand. */
export function HolidaysList() {
  // The studio's calendar year, in Lagos.
  const [initialYear] = useState(() =>
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric' }).format(new Date())),
  );
  const [year, setYear] = useState(initialYear);
  const data = useQuery(api.holidays.list, { year });
  const estimates = data?.holidays.filter((holiday) => holiday.needsConfirmation).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Year" className="flex gap-1">
          {[initialYear - 1, initialYear, initialYear + 1].map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === year ? 'default' : 'outline'}
              aria-pressed={option === year}
              onClick={() => setYear(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        {data?.canEdit && (
          <div className="sm:ml-auto">
            <HolidayDialog
              year={year}
              trigger={
                <Button size="sm" variant="outline">
                  <Plus aria-hidden />
                  Add a holiday
                </Button>
              }
            />
          </div>
        )}
      </div>

      {estimates > 0 && (
        <p className="rounded-md bg-draft p-3 text-sm text-draft-foreground">
          {estimates === 1 ? '1 holiday has an estimated date' : `${estimates} holidays have estimated dates`}. Confirm
          each once the Federal Government declares it.
        </p>
      )}

      {data === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : data.holidays.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          No holidays for {year} yet. They are added each January.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">Public holidays in {year}</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Holiday
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.holidays.map((holiday) => (
                <tr key={holiday.id} className="border-t">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="block">{formatDateRange(holiday.date, holiday.date)}</span>
                    <span className="block text-muted-foreground">{weekday(holiday.date)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="mr-2 font-medium">{holiday.name}</span>
                    {holiday.needsConfirmation && <ToneBadge label="Estimated date" tone="draft" />}
                    {holiday.source === 'manual' && <ToneBadge label="Added" tone="muted" />}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {data.canEdit && <HolidayActions holiday={holiday} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HolidayActions({ holiday }: { holiday: Holiday }) {
  const remove = useMutation(api.holidays.remove);
  return (
    <div className="flex justify-end gap-1">
      <HolidayDialog
        year={Number(holiday.date.slice(0, 4))}
        holiday={holiday}
        trigger={
          <Button
            size="sm"
            variant={holiday.needsConfirmation ? 'default' : 'ghost'}
            aria-label={`${holiday.needsConfirmation ? 'Confirm date' : 'Edit'} for ${holiday.name}`}
          >
            {holiday.needsConfirmation ? 'Confirm date' : 'Edit'}
          </Button>
        }
      />
      {holiday.source === 'manual' && (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="ghost" aria-label={`Remove ${holiday.name}`}>
              Remove
            </Button>
          }
          title={`Remove ${holiday.name}?`}
          description="It stops counting as a holiday for SLA timers and time off."
          confirmLabel="Remove"
          onConfirm={() => remove({ holidayId: holiday.id })}
        />
      )}
    </div>
  );
}

function HolidayDialog({ year, holiday, trigger }: { year: number; holiday?: Holiday; trigger: ReactNode }) {
  const add = useMutation(api.holidays.add);
  const update = useMutation(api.holidays.update);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(holiday?.date ?? '');
  const [name, setName] = useState(holiday?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirming = holiday?.needsConfirmation === true;
  const idSuffix = holiday?.id ?? `new-${year}`;

  async function save() {
    setPending(true);
    setError(null);
    try {
      if (holiday) {
        await update({ holidayId: holiday.id as Id<'holidays'>, date, name });
      } else {
        await add({ date, name });
        setDate('');
        setName('');
      }
      setOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDate(holiday?.date ?? '');
          setName(holiday?.name ?? '');
        }
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {holiday ? (confirming ? `Confirm ${holiday.name}` : `Edit ${holiday.name}`) : `Add a holiday in ${year}`}
          </DialogTitle>
          <DialogDescription>
            {confirming
              ? 'Set the date the Federal Government declared. Saving confirms it.'
              : holiday
                ? 'Saving keeps the holiday confirmed.'
                : 'For a day the Federal Government declares, such as an extra day after Eid.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id={`holiday-form-${idSuffix}`}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`holiday-date-${idSuffix}`}>Date</Label>
            <Input
              id={`holiday-date-${idSuffix}`}
              type="date"
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`holiday-name-${idSuffix}`}>Name</Label>
            <Input id={`holiday-name-${idSuffix}`} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={`holiday-form-${idSuffix}`} disabled={pending || !date || !name.trim()}>
            {pending ? 'Saving…' : confirming ? 'Confirm date' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
