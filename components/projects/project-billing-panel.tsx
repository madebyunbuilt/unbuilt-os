'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { InvoiceList } from '@/components/billing/invoice-list';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { ITEM_STATUS_LABELS, TRIGGER_LABELS } from '@/lib/change-requests-display';
import { formatDay } from '@/lib/crm-display';
import { lagosToday } from '@/lib/invoices-display';

// How a project is billed (08-billing-and-finance.md): the schedule that raises its invoices stage by stage, the
// retainer that bills it monthly, and the invoices themselves. A project has one or the other, rarely both.

type Schedule = NonNullable<typeof api.billingSchedules.forProject._returnType>;
type Retainer = NonNullable<typeof api.retainers.forProject._returnType>;

const hours = (minutes: number) => {
  const value = minutes / 60;
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
};

/** Two halves — half on signature, half at the end — which is the studio's default for a fixed-price project. */
function CreateScheduleDialog({ projectId, trigger }: { projectId: Id<'projects'>; trigger: ReactNode }) {
  const create = useMutation(api.billingSchedules.create);
  const [autoSend, setAutoSend] = useState(false);
  return (
    <FormDialog
      trigger={trigger}
      title="Set up a billing schedule"
      description="The project's amount, split into the stages it is invoiced in. It starts as a draft until the parts add up."
      submitLabel="Set it up"
      onSubmit={() =>
        create({
          projectId,
          autoSend,
          items: [
            { label: 'On signature', kind: 'percent', bps: 5_000, trigger: 'on_signature' },
            { label: 'On final approval', kind: 'percent', bps: 5_000, trigger: 'on_milestone_approved' },
          ],
        })
      }
    >
      <p className="text-sm text-muted-foreground">
        It starts with the studio&rsquo;s usual split: half when the contract is signed, half when the last milestone is
        approved. Change the parts before turning it on.
      </p>
      <div className="flex items-center gap-2">
        <Checkbox id="schedule-auto-send" checked={autoSend} onCheckedChange={(v) => setAutoSend(v === true)} />
        <Label htmlFor="schedule-auto-send" className="font-normal">
          Send these invoices without waiting for Finance
        </Label>
      </div>
    </FormDialog>
  );
}

function SkipItemDialog({ schedule, itemId, label }: { schedule: Schedule; itemId: string; label: string }) {
  const skipItem = useMutation(api.billingSchedules.skipItem);
  const [reason, setReason] = useState('');
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          Skip
        </Button>
      }
      title={`Skip ${label}`}
      description="It will never be invoiced. The rest of the schedule is left alone."
      submitLabel="Skip it"
      canSubmit={reason.trim().length > 0}
      onSubmit={() => skipItem({ scheduleId: schedule.id, itemId, reason })}
    >
      <div className="space-y-2">
        <Label htmlFor="skip-reason">Why</Label>
        <Textarea id="skip-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </FormDialog>
  );
}

function ScheduleCard({ schedule, canManage }: { schedule: Schedule; canManage: boolean }) {
  const activate = useMutation(api.billingSchedules.activate);
  const pause = useMutation(api.billingSchedules.pause);
  const invoiceNow = useMutation(api.billingSchedules.invoiceNow);
  const currency = schedule.currency as Currency;
  const addsUp = schedule.scheduledMinor === schedule.amountMinor;

  return (
    <section className="rounded-lg border p-4" aria-labelledby="billing-schedule">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="billing-schedule" className="font-display text-lg font-bold">
            Billing schedule
          </h3>
          <p className="text-sm text-muted-foreground">
            {formatMoney(schedule.amountMinor, currency)} in {schedule.items.length} part
            {schedule.items.length === 1 ? '' : 's'}
            {schedule.autoSend ? ' · sent automatically' : ' · drafts for Finance'}
          </p>
        </div>
        <ToneBadge
          label={schedule.status === 'active' ? 'On' : schedule.status === 'draft' ? 'Draft' : 'Ended'}
          tone={schedule.status === 'active' ? 'built' : 'draft'}
        />
      </div>

      {!addsUp && (
        <p role="status" className="mt-3 rounded-md border p-3 text-sm">
          The parts come to {formatMoney(schedule.scheduledMinor, currency)}, and the project is{' '}
          {formatMoney(schedule.amountMinor, currency)}. They must match before it can be turned on.
        </p>
      )}

      <ul className="mt-3 divide-y border-t">
        {schedule.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-sm text-muted-foreground">
                {TRIGGER_LABELS[item.trigger] ?? item.trigger}
                {item.date ? ` · ${formatDay(item.date)}` : ''}
                {' · '}
                {ITEM_STATUS_LABELS[item.status] ?? item.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm tabular-nums">{formatMoney(item.amountMinor, currency)}</span>
              {item.invoiceId && (
                <Link href={`/billing/invoices/${item.invoiceId}`} className="text-sm underline">
                  Invoice
                </Link>
              )}
              {canManage && schedule.status === 'active' && item.status === 'pending' && (
                <>
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm">
                        Invoice now
                      </Button>
                    }
                    title={`Invoice ${item.label} now`}
                    description="Raises its invoice before its trigger, for a client who asks to be billed early."
                    confirmLabel="Raise it"
                    onConfirm={() => invoiceNow({ scheduleId: schedule.id, itemId: item.id })}
                  />
                  <SkipItemDialog schedule={schedule} itemId={item.id} label={item.label} />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {schedule.status === 'draft' ? (
            <Button disabled={!addsUp} onClick={() => void activate({ scheduleId: schedule.id })}>
              Turn it on
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void pause({ scheduleId: schedule.id })}>
              Pause it
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function CreateRetainerDialog({ projectId, trigger }: { projectId: Id<'projects'>; trigger: ReactNode }) {
  const create = useMutation(api.retainers.create);
  const [fee, setFee] = useState('');
  const [includedHours, setIncludedHours] = useState('');
  const [overage, setOverage] = useState('');
  const [invoiceDay, setInvoiceDay] = useState('1');
  const [startDate, setStartDate] = useState(lagosToday());
  const [rollover, setRollover] = useState(false);
  const [autoSend, setAutoSend] = useState(false);

  return (
    <FormDialog
      trigger={trigger}
      title="Set up a retainer"
      description="A monthly fee for a number of included hours. The fee is invoiced a period in advance; anything beyond the hours is billed after the period."
      submitLabel="Set it up"
      canSubmit={fee.trim().length > 0 && includedHours.trim().length > 0}
      onSubmit={() =>
        create({
          projectId,
          startDate,
          monthlyFeeMinor: parseMoneyInput(fee, 'NGN'),
          includedMinutes: Math.round(Number(includedHours) * 60),
          overageRateMinor: overage.trim() ? parseMoneyInput(overage, 'NGN') : 0,
          invoiceDayOfMonth: Number(invoiceDay) || 1,
          rolloverUnusedMinutes: rollover,
          autoSend,
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="retainer-fee">Monthly fee</Label>
          <Input id="retainer-fee" inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="retainer-hours">Included hours</Label>
          <Input
            id="retainer-hours"
            inputMode="decimal"
            value={includedHours}
            onChange={(event) => setIncludedHours(event.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="retainer-overage">Overage, an hour</Label>
          <Input
            id="retainer-overage"
            inputMode="decimal"
            value={overage}
            onChange={(event) => setOverage(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="retainer-day">Invoice day</Label>
          <Input
            id="retainer-day"
            inputMode="numeric"
            value={invoiceDay}
            onChange={(event) => setInvoiceDay(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="retainer-start">Starts</Label>
          <Input
            id="retainer-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox id="retainer-rollover" checked={rollover} onCheckedChange={(v) => setRollover(v === true)} />
          <Label htmlFor="retainer-rollover" className="font-normal">
            Unused hours carry into the next period
            <span className="block text-sm text-muted-foreground">They expire after that one period.</span>
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="retainer-auto-send" checked={autoSend} onCheckedChange={(v) => setAutoSend(v === true)} />
          <Label htmlFor="retainer-auto-send" className="font-normal">
            Send these invoices without waiting for Finance
          </Label>
        </div>
      </div>
    </FormDialog>
  );
}

function RetainerCard({ retainer, canManage }: { retainer: Retainer; canManage: boolean }) {
  const setStatus = useMutation(api.retainers.setStatus);
  const currency = retainer.currency as Currency;
  const current = retainer.current;

  return (
    <section className="rounded-lg border p-4" aria-labelledby="retainer">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="retainer" className="font-display text-lg font-bold">
            Retainer
          </h3>
          <p className="text-sm text-muted-foreground">
            {formatMoney(retainer.monthlyFeeMinor, currency)} a month for {hours(retainer.includedMinutes)} hours ·
            invoiced on the {retainer.invoiceDayOfMonth}
            {retainer.rolloverUnusedMinutes ? ' · unused hours carry one period' : ''}
          </p>
        </div>
        <ToneBadge
          label={retainer.status === 'active' ? 'On' : retainer.status === 'paused' ? 'Paused' : 'Ended'}
          tone={retainer.status === 'active' ? 'built' : 'draft'}
        />
      </div>

      {current && (
        <div className="mt-3 rounded-md border p-3">
          <p className="text-sm font-medium">
            {formatDay(current.periodStart)} to {formatDay(current.periodEnd)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hours(current.usedMinutes)} of {hours(current.includedMinutes + current.rolloverMinutes)} hours used
            {current.rolloverMinutes > 0 ? ` (${hours(current.rolloverMinutes)} carried in)` : ''} ·{' '}
            {current.overageMinutes > 0
              ? `${hours(current.overageMinutes)} hours over, billed at the end of the period`
              : `${hours(current.remainingMinutes)} left`}
          </p>
        </div>
      )}

      {retainer.past.length > 0 && (
        <ul className="mt-3 divide-y border-t text-sm">
          {retainer.past.slice(0, 6).map((period) => (
            <li key={period.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {formatDay(period.periodStart)} to {formatDay(period.periodEnd)}
              </span>
              <span className="text-muted-foreground">
                {hours(period.usedMinutes)} hours
                {period.overageMinutes > 0 ? ` · ${hours(period.overageMinutes)} over` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && retainer.status !== 'ended' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void setStatus({ retainerId: retainer.id, status: retainer.status === 'active' ? 'paused' : 'active' })
            }
          >
            {retainer.status === 'active' ? 'Pause it' : 'Start it again'}
          </Button>
          <ConfirmDialog
            trigger={<Button variant="ghost">End it</Button>}
            title="End this retainer"
            description="No further periods open, and nothing more is invoiced. What has already been billed stays."
            confirmLabel="End it"
            onConfirm={() => setStatus({ retainerId: retainer.id, status: 'ended' })}
          />
        </div>
      )}
    </section>
  );
}

export function ProjectBillingPanel({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const schedule = useQuery(api.billingSchedules.forProject, { projectId });
  const retainer = useQuery(api.retainers.forProject, { projectId });
  const canSchedule = permissions.includes('schedules.manage');
  const canRetain = permissions.includes('retainers.manage');

  return (
    <div className="space-y-6">
      {schedule ? (
        <ScheduleCard schedule={schedule} canManage={canSchedule} />
      ) : (
        canSchedule &&
        !retainer && (
          <section className="rounded-lg border border-dashed p-6">
            <h3 className="font-display text-lg font-bold">Billing schedule</h3>
            <p className="mt-1 mb-3 text-sm text-muted-foreground">
              Split this project&rsquo;s amount into the stages it is invoiced in.
            </p>
            <CreateScheduleDialog projectId={projectId} trigger={<Button>Set up a schedule</Button>} />
          </section>
        )
      )}

      {retainer ? (
        <RetainerCard retainer={retainer} canManage={canRetain} />
      ) : (
        canRetain &&
        !schedule && (
          <section className="rounded-lg border border-dashed p-6">
            <h3 className="font-display text-lg font-bold">Retainer</h3>
            <p className="mt-1 mb-3 text-sm text-muted-foreground">
              Bill this project monthly instead, for a number of included hours.
            </p>
            <CreateRetainerDialog projectId={projectId} trigger={<Button>Set up a retainer</Button>} />
          </section>
        )
      )}

      {permissions.includes('invoices.view') && (
        <section aria-labelledby="project-invoices" className="space-y-3">
          <h3 id="project-invoices" className="font-display text-lg font-bold">
            Invoices
          </h3>
          <ProjectInvoices projectId={projectId} permissions={permissions} />
        </section>
      )}
    </div>
  );
}

/** The project's own invoices, read from the invoice list the client page already uses. */
function ProjectInvoices({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const project = useQuery(api.projects.get, { projectId });
  if (!project) return <p className="text-muted-foreground">Loading invoices…</p>;
  return <InvoiceList permissions={permissions} clientId={project.clientId} projectId={projectId} />;
}
