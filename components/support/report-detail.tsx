'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { formatDay } from '@/lib/crm-display';
import {
  compliance,
  formatMoment,
  lateness,
  monthLabel,
  priorityLabel,
  priorityTone,
  TARGET_LABEL,
  type TicketPriority,
  uptime,
} from '@/lib/support-display';
import { formatDuration } from '@/lib/time-display';

// One month's SLA report (09-support-and-sla.md). The studio reads it before the client does, which is the whole
// point of it waiting here: the figures are fixed, but whether they are worth sending is a judgement.

type Report = NonNullable<typeof api.slaReports.get._returnType>;

export function ReportFigures({ report }: { report: Report | NonNullable<typeof api.portalReports.get._returnType> }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="by-priority" className="space-y-3">
        <h2 id="by-priority" className="font-display text-xl font-bold">
          What came in, and what was promised
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="p-3 font-medium">Priority</th>
                <th className="p-3 font-medium">Raised</th>
                <th className="p-3 font-medium">Resolved</th>
                <th className="p-3 font-medium">Replied in time</th>
                <th className="p-3 font-medium">Fixed in time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.byPriority.map((row) => (
                <tr key={row.priority}>
                  <td className="p-3">
                    <ToneBadge
                      label={priorityLabel(row.priority as TicketPriority)}
                      tone={priorityTone(row.priority as TicketPriority)}
                    />
                  </td>
                  <td className="p-3 tabular-nums">{row.opened}</td>
                  <td className="p-3 tabular-nums">{row.resolved}</td>
                  <td className="p-3 tabular-nums">{compliance(row.firstResponseComplianceBps)}</td>
                  <td className="p-3 tabular-nums">{compliance(row.resolutionComplianceBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="breaches" className="space-y-3">
        <h2 id="breaches" className="font-display text-xl font-bold">
          What was missed
        </h2>
        {report.breaches.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">Nothing was missed this month.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {report.breaches.map((breach, index) => (
              <li key={`${breach.number}-${breach.target}-${index}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {breach.number}: {breach.subject}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {TARGET_LABEL[breach.target]} · {lateness(breach.lateMinutes)}
                    </p>
                  </div>
                  <ToneBadge
                    label={priorityLabel(breach.priority as TicketPriority)}
                    tone={priorityTone(breach.priority as TicketPriority)}
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {breach.reason ?? 'No reason has been given for this one.'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.retainerMinutes && (
        <section aria-labelledby="hours" className="space-y-3">
          <h2 id="hours" className="font-display text-xl font-bold">
            Retainer hours
          </h2>
          <p className="rounded-lg border p-4">
            {formatDuration(report.retainerMinutes.used)} used of {formatDuration(report.retainerMinutes.included)}
          </p>
        </section>
      )}

      {report.monitoring === 'not_monitored' ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Unbuilt was not monitoring anything for you this month, so there is no uptime to report.
        </p>
      ) : (
        <section aria-labelledby="uptime" className="space-y-3">
          <h2 id="uptime" className="font-display text-xl font-bold">
            What stayed up
          </h2>
          {report.uptime.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-muted-foreground">
              Nothing was checked this month, so there is no uptime figure to give.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="p-3 font-medium">What</th>
                    <th className="p-3 font-medium">Uptime</th>
                    <th className="p-3 font-medium">Promised</th>
                    <th className="p-3 font-medium">Checks</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.uptime.map((row) => (
                    <tr key={row.monitorId}>
                      <td className="p-3">
                        <span className="block">{row.name}</span>
                        <span className="block text-xs break-all text-muted-foreground">{row.url}</span>
                      </td>
                      <td className="p-3 tabular-nums">{uptime(row.uptimeBps)}</td>
                      <td className="p-3">
                        {row.targetBps === undefined ? (
                          <span className="text-muted-foreground">None set</span>
                        ) : (
                          <ToneBadge
                            {...(row.uptimeBps >= row.targetBps
                              ? { label: `Met ${uptime(row.targetBps)}`, tone: 'built' as const }
                              : { label: `Under ${uptime(row.targetBps)}`, tone: 'attention' as const })}
                          />
                        )}
                      </td>
                      <td className="p-3 tabular-nums text-muted-foreground">{row.checks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.incidents.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {report.incidents.map((incident, index) => (
                <li key={`${incident.monitorName}-${index}`} className="p-4">
                  <p className="font-medium">{incident.summary}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatMoment(incident.startedAt)} ·{' '}
                    {incident.resolvedAt === undefined
                      ? 'still down at the end of the month'
                      : `down for ${incident.downMinutes} minute${incident.downMinutes === 1 ? '' : 's'}`}
                    {incident.ticketNumber ? ` · ${incident.ticketNumber}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export function ReportDetail({ reportId }: { reportId: Id<'slaReports'> }) {
  const report = useQuery(api.slaReports.get, { reportId });
  const send = useMutation(api.slaReports.send);
  const [error, setError] = useState<string | null>(null);

  if (report === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (report === null) {
    return (
      <div className="space-y-3">
        <Link href="/support/reports" className="text-sm underline">
          ← Reports
        </Link>
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">That report is not here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/support/reports" className="text-sm underline">
          ← Reports
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">{report.clientName}</h1>
            <p className="mt-1 text-muted-foreground">
              {monthLabel(report.periodStart)}
              {report.policyName ? ` · ${report.policyName}` : ''}
            </p>
          </div>
          {report.status === 'sent' ? (
            <ToneBadge label={`Sent ${formatDay(new Date(report.sentAt!).toISOString().slice(0, 10))}`} tone="built" />
          ) : (
            <ConfirmDialog
              trigger={<Button>Send it</Button>}
              title={`Send ${monthLabel(report.periodStart)} to ${report.clientName}`}
              description="The client sees these figures in their portal. Nothing here changes afterwards."
              confirmLabel="Send it"
              onConfirm={async () => {
                setError(null);
                try {
                  await send({ reportId });
                } catch (caught) {
                  setError(errorMessage(caught));
                  throw caught;
                }
              }}
            />
          )}
        </div>
      </div>

      {report.status === 'draft' && (
        <p className="rounded-md border border-attention p-4 text-sm">
          The client has not seen this yet. Read it, add a reason to anything that was missed, then send it.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <ReportFigures report={report} />
    </div>
  );
}
