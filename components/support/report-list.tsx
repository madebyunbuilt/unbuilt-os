'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { ToneBadge } from '@/components/team/status-badge';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { monthLabel } from '@/lib/support-display';

// The studio's SLA reports (09-support-and-sla.md). Drafts first: a report nobody has sent is a client still waiting.

export function ReportList() {
  const [status, setStatus] = useState<'draft' | 'sent' | 'all'>('draft');
  const reports = useQuery(api.slaReports.list, status === 'all' ? {} : { status });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="report-filter" className="text-xs text-muted-foreground">
          Show
        </Label>
        <NativeSelect
          id="report-filter"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="draft">Waiting to be sent</option>
          <option value="sent">Already sent</option>
          <option value="all">Everything</option>
        </NativeSelect>
      </div>

      {reports === undefined ? (
        <p className="text-muted-foreground">Loading reports…</p>
      ) : reports.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          {status === 'draft' ? 'Nothing is waiting. Reports are written when a month closes.' : 'No reports here yet.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id} className="rounded-lg border p-4">
              <Link href={`/support/reports/${report.id}`} className="block">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{report.clientName}</p>
                    <p className="text-sm text-muted-foreground">
                      {monthLabel(report.periodStart)} ·{' '}
                      {report.breaches.length === 0
                        ? 'nothing missed'
                        : `${report.breaches.length} missed target${report.breaches.length === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <ToneBadge
                    {...(report.status === 'sent'
                      ? { label: 'Sent', tone: 'built' as const }
                      : { label: 'Waiting to be sent', tone: 'attention' as const })}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
