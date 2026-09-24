'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import { portalInvoiceStatus } from '@/lib/portal-display';

// A client's invoices (12-client-portal.md, Invoices): what is owed, what was paid, and how to pay the rest. Nothing
// the studio wrote off appears, and no internal reference is ever shown.

export function PortalInvoices() {
  const invoices = useQuery(api.portalBilling.invoices, {});
  if (invoices === undefined) return <p className="text-muted-foreground">Loading invoices…</p>;
  if (invoices.length === 0) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">Nothing to pay right now.</p>;
  }
  return (
    <ul className="space-y-3">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="rounded-lg border p-4">
          <Link href={`/invoices/${invoice.id}`} className="block">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {invoice.typeLabel} {invoice.number}
                </p>
                <p className="text-sm text-muted-foreground">
                  {invoice.dueDate ? `Due ${formatDay(invoice.dueDate)}` : 'Due'}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums">
                  {formatMoney(
                    invoice.payable ? invoice.balanceMinor : invoice.totalMinor,
                    invoice.currency as Currency,
                  )}
                </p>
                <ToneBadge {...portalInvoiceStatus(invoice.status)} />
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PortalInvoice({ invoiceId }: { invoiceId: Id<'invoices'> }) {
  const invoice = useQuery(api.portalBilling.invoice, { invoiceId });
  const pay = useQuery(api.portalBilling.payLink, invoice?.payable ? { invoiceId } : 'skip');
  const pdf = useQuery(api.files.portalDownloadUrl, invoice?.pdfFileId ? { fileId: invoice.pdfFileId } : 'skip');

  if (invoice === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (invoice === null) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">This invoice is not available.</p>;
  }
  const currency = invoice.currency as Currency;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/invoices" className="text-sm underline">
          ← Invoices
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">
              {invoice.typeLabel} {invoice.number}
            </h1>
            <p className="mt-1 text-muted-foreground">
              {invoice.issueDate ? `Issued ${formatDay(invoice.issueDate)}` : ''}
              {invoice.dueDate ? ` · due ${formatDay(invoice.dueDate)}` : ''}
            </p>
          </div>
          <ToneBadge {...portalInvoiceStatus(invoice.status)} />
        </div>
      </div>

      <dl className="space-y-1 rounded-lg border p-4">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="tabular-nums">{formatMoney(invoice.totalMinor, currency)}</dd>
        </div>
        {invoice.paidMinor > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="tabular-nums">{formatMoney(invoice.paidMinor, currency)}</dd>
          </div>
        )}
        {invoice.whtCreditedMinor > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Withholding tax you remitted</dt>
            <dd className="tabular-nums">{formatMoney(invoice.whtCreditedMinor, currency)}</dd>
          </div>
        )}
        {invoice.creditedMinor > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Credited</dt>
            <dd className="tabular-nums">{formatMoney(invoice.creditedMinor, currency)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t pt-1 font-medium">
          <dt>{invoice.payable ? 'Still to pay' : 'Settled'}</dt>
          <dd className="tabular-nums">{formatMoney(invoice.balanceMinor, currency)}</dd>
        </div>
        {invoice.whtOnBalanceMinor > 0 && (
          <p className="pt-2 text-sm text-muted-foreground">
            If you withhold tax, pay {formatMoney(invoice.balanceMinor - invoice.whtOnBalanceMinor, currency)} and send
            us the certificate for {formatMoney(invoice.whtOnBalanceMinor, currency)}.
          </p>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        {invoice.payable && invoice.byCard && pay?.url && (
          // A new tab: paying redirects the whole window to Paystack and comes back to the public pay page, which has
          // no way into the portal. Closing the tab puts them back on this invoice, already updated.
          <Button asChild>
            <a href={pay.url} target="_blank" rel="noopener noreferrer">
              Pay this invoice <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        )}
        {pdf && (
          <Button variant="outline" asChild>
            <a href={pdf.url} target="_blank" rel="noreferrer">
              Download the PDF
            </a>
          </Button>
        )}
      </div>

      {invoice.payable && invoice.bankAccounts.length > 0 && (
        <section aria-labelledby="bank" className="space-y-2 rounded-lg border p-4">
          <h2 id="bank" className="font-display text-lg font-bold">
            Pay by bank transfer
          </h2>
          <p className="text-sm text-muted-foreground">Please quote {invoice.number} as the reference.</p>
          {invoice.bankAccounts.map((account, index) => (
            <div key={index} className="text-sm">
              <p className="font-medium">{account.bankName}</p>
              <p>{account.accountName}</p>
              <p className="tabular-nums">{account.accountNumber}</p>
            </div>
          ))}
        </section>
      )}

      {invoice.payments.length > 0 && (
        <section aria-labelledby="paid" className="space-y-2">
          <h2 id="paid" className="font-display text-lg font-bold">
            What you have paid
          </h2>
          <ul className="divide-y rounded-lg border">
            {invoice.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <p className="font-medium tabular-nums">{formatMoney(payment.amountMinor, currency)}</p>
                  <p className="text-muted-foreground">
                    {formatDay(payment.receivedOn)} · {payment.method}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </p>
                </div>
                {payment.receiptNumber && (
                  <span className="text-muted-foreground">Receipt {payment.receiptNumber}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {invoice.creditNotes.length > 0 && (
        <section aria-labelledby="credits" className="space-y-2">
          <h2 id="credits" className="font-display text-lg font-bold">
            Credit notes
          </h2>
          <ul className="divide-y rounded-lg border">
            {invoice.creditNotes.map((note) => (
              <li key={note.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <span>
                  {note.number}
                  {note.issuedOn ? ` · ${formatDay(note.issuedOn)}` : ''}
                </span>
                <span className="tabular-nums">{formatMoney(note.amountMinor, currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
