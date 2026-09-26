'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { ReportFigures } from '@/components/support/report-detail';
import { ToneBadge } from '@/components/team/status-badge';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatDay } from '@/lib/crm-display';
import { monthLabel } from '@/lib/support-display';

// SLA reports in the portal (12-client-portal.md, Support). The same figures the studio read before sending them —
// one report, not a version for each side — and only ever after somebody has sent it.

export function PortalReports() {
  const reports = useQuery(api.portalReports.list, {});
  if (reports === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (reports.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-muted-foreground">
        No reports yet. Unbuilt sends one after each month, covering how it did against what it promised.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {reports.map((report) => (
        <li key={report.id} className="rounded-lg border p-4">
          <Link href={`/reports/${report.id}`} className="block">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{monthLabel(report.periodStart)}</p>
                <p className="text-sm text-muted-foreground">
                  {report.sentAt ? `Sent ${formatDay(new Date(report.sentAt).toISOString().slice(0, 10))}` : ''}
                </p>
              </div>
              <ToneBadge
                {...(report.breaches === 0
                  ? { label: 'Everything on time', tone: 'built' as const }
                  : {
                      label: `${report.breaches} missed target${report.breaches === 1 ? '' : 's'}`,
                      tone: 'attention' as const,
                    })}
              />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PortalReport({ reportId }: { reportId: Id<'slaReports'> }) {
  const report = useQuery(api.portalReports.get, { reportId });
  if (report === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (report === null) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">This report is not available.</p>;
  }
  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-sm underline">
          ← Reports
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">{monthLabel(report.periodStart)}</h1>
        <p className="mt-1 text-muted-foreground">How Unbuilt did against what it promised you.</p>
      </div>
      <ReportFigures report={report} />
    </div>
  );
}
