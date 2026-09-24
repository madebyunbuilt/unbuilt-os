'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { InvoiceFormDialog } from '@/components/billing/invoice-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatMoney } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import { INVOICE_STATUSES, type InvoiceStatus, invoiceStatus } from '@/lib/invoices-display';

/** Invoices, newest first (08-billing-and-finance.md), on their own page or a client's. */
export function InvoiceList({
  permissions,
  clientId,
  projectId,
  heading,
}: {
  permissions: string[];
  clientId?: Id<'clients'>;
  projectId?: Id<'projects'>;
  heading?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(clientId ? 'all' : 'open');
  const invoices = useQuery(api.invoices.list, { clientId, projectId, status });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {heading && <h2 className="font-display text-xl font-bold">{heading}</h2>}
        <div className="space-y-1">
          <Label htmlFor="invoice-status-filter" className="text-xs text-muted-foreground">
            Show
          </Label>
          <NativeSelect id="invoice-status-filter" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="open">Waiting for money</option>
            <option value="all">Everything</option>
            {INVOICE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {invoiceStatus(value).label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {permissions.includes('invoices.create') && (
          <div className="sm:ml-auto">
            <InvoiceFormDialog
              clientId={clientId}
              canUseRateCard={permissions.includes('ratecard.view')}
              onSaved={(invoiceId) => router.push(`/billing/invoices/${invoiceId}`)}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  New invoice
                </Button>
              }
            />
          </div>
        )}
      </div>

      {invoices === undefined ? (
        <p className="text-muted-foreground">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">No invoices here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-3xl text-sm">
            <caption className="sr-only">Invoices</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Invoice
                </th>
                {!clientId && (
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Client
                  </th>
                )}
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Still owed
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Due
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t hover:bg-accent/50">
                  <td className="px-4 py-3">
                    <Link href={`/billing/invoices/${invoice.id}`} className="block">
                      <span className="block font-medium">{invoice.number ?? 'Draft'}</span>
                      <span className="block text-muted-foreground">
                        {invoice.typeLabel}
                        {invoice.projectName ? ` · ${invoice.projectName}` : ''}
                      </span>
                    </Link>
                  </td>
                  {!clientId && <td className="px-4 py-3">{invoice.clientName}</td>}
                  <td className="px-4 py-3">
                    <ToneBadge {...invoiceStatus(invoice.status as InvoiceStatus, invoice)} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(invoice.totals.totalMinor, invoice.currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {invoice.status === 'draft' || invoice.status === 'void'
                      ? '—'
                      : formatMoney(invoice.balanceMinor, invoice.currency)}
                  </td>
                  <td className="px-4 py-3">{invoice.dueDate ? formatDay(invoice.dueDate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
