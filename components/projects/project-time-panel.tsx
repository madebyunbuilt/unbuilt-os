'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { EntryFormDialog } from '@/components/time/entry-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { CLOSED_PROJECT_STATUSES } from '@/convex/lib/projectStatus';
import { errorMessage } from '@/lib/convex-error';
import { formatDay, toAmountInput } from '@/lib/crm-display';
import { formatDuration, timeEntryStatus } from '@/lib/time-display';

// A project's time (06-projects.md, Project time). `time.view.all` sees everyone's; everyone else sees only their own.
// Rates show only with team.rates.sensitive, which is also what fills in a rate logged before Finance set one.

type Entry = (typeof api.time.listForProject._returnType)['entries'][number];

export function ProjectTimePanel({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const project = useQuery(api.projects.get, { projectId });
  const time = useQuery(api.time.listForProject, { projectId });
  const summary = useQuery(api.time.projectSummary, { projectId });
  const canSeeRates = permissions.includes('team.rates.sensitive');

  if (project === undefined || time === undefined) return <p className="text-muted-foreground">Loading time…</p>;

  const isOpen = !CLOSED_PROJECT_STATUSES.has(project.status);
  const canLog = permissions.includes('time.log.own') && project.isMember;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">{time.scope === 'own' ? 'My hours' : 'Logged'}</p>
          <p className="mt-1 font-display text-2xl font-bold">{formatDuration(time.totals.minutes)}</p>
          <p className="text-sm text-muted-foreground">{formatDuration(time.totals.billableMinutes)} billable</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Approved</p>
          <p className="mt-1 font-display text-2xl font-bold">
            {summary ? formatDuration(summary.approvedMinutes) : '—'}
          </p>
          <p className="text-sm text-muted-foreground">Ready to invoice on time and materials</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Task estimates</p>
          <p className="mt-1 font-display text-2xl font-bold">
            {summary ? formatDuration(summary.estimateMinutes) : '—'}
          </p>
          <p className="text-sm text-muted-foreground">
            {summary?.missingRates ? `${summary.missingRates} entries have no rate` : 'Across every task'}
          </p>
        </div>
      </div>

      {canLog && isOpen && (
        <EntryFormDialog
          projectId={projectId}
          date={new Date().toISOString().slice(0, 10)}
          trigger={
            <Button>
              <Plus aria-hidden />
              Log time on this project
            </Button>
          }
        />
      )}

      {time.entries.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          {time.scope === 'own' ? 'You have logged no time here yet.' : 'No time logged on this project yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[42rem] text-sm">
            <caption className="sr-only">Time logged on this project</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Who
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  What
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Time
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  State
                </th>
                {canSeeRates && (
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Bill rate
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {time.entries.map((entry) => (
                <tr key={entry.id} className="border-t">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDay(entry.date)}</td>
                  <td className="px-4 py-3">{entry.memberName}</td>
                  <td className="px-4 py-3">
                    {entry.description}
                    {entry.taskTitle && <span className="text-muted-foreground"> · {entry.taskTitle}</span>}
                    {!entry.billable && <span className="text-muted-foreground"> · not billable</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDuration(entry.minutes)}</td>
                  <td className="px-4 py-3">
                    <ToneBadge {...timeEntryStatus(entry.status)} />
                  </td>
                  {canSeeRates && (
                    <td className="px-4 py-3 text-right">
                      {entry.billRateMinor !== undefined && entry.rateCurrency ? (
                        <span className="tabular-nums">{formatMoney(entry.billRateMinor, entry.rateCurrency)}</span>
                      ) : entry.status === 'invoiced' ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <RateDialog entry={entry} currency={project.currency} />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Fills in the rates on an entry logged before Finance set the member's rates. */
function RateDialog({ entry, currency }: { entry: Entry; currency: Currency }) {
  const setRates = useMutation(api.time.setEntryRates);
  const [open, setOpen] = useState(false);
  const [bill, setBill] = useState(toAmountInput(entry.billRateMinor));
  const [cost, setCost] = useState(toAmountInput(entry.costRateMinor));
  const [rateCurrency, setRateCurrency] = useState<Currency>(entry.rateCurrency ?? currency);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add a rate
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Rates for this entry</DialogTitle>
            <DialogDescription>
              {entry.memberName} logged {formatDuration(entry.minutes)} on {formatDay(entry.date)} before their rates
              were set. The change is recorded in the audit log with the amounts hidden.
            </DialogDescription>
          </DialogHeader>
          <form
            id={`rates-${entry.id}`}
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setSaving(true);
              setError(null);
              try {
                await setRates({
                  entryId: entry.id,
                  billRateMinor: bill.trim() ? parseMoneyInput(bill, rateCurrency) : undefined,
                  costRateMinor: cost.trim() ? parseMoneyInput(cost, rateCurrency) : undefined,
                  currency: rateCurrency,
                });
                setOpen(false);
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setSaving(false);
              }
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`bill-${entry.id}`}>Bill rate an hour</Label>
                <Input
                  id={`bill-${entry.id}`}
                  inputMode="decimal"
                  value={bill}
                  onChange={(event) => setBill(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`cost-${entry.id}`}>Cost rate an hour</Label>
                <Input
                  id={`cost-${entry.id}`}
                  inputMode="decimal"
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`currency-${entry.id}`}>Currency</Label>
              <NativeSelect
                id={`currency-${entry.id}`}
                value={rateCurrency}
                onChange={(event) => setRateCurrency(event.target.value as Currency)}
              >
                <option value="NGN">NGN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </NativeSelect>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button type="submit" form={`rates-${entry.id}`} disabled={saving}>
              {saving ? 'Saving…' : 'Save rates'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
