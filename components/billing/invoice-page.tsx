'use client';

import { useQuery } from 'convex/react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApplyCreditDialog,
  CreditNoteDialog,
  DeleteDraftButton,
  RecordPaymentDialog,
  RefundPaymentDialog,
  RemindersToggle,
  ReverseWriteOffButton,
  SendAgainDialog,
  SendInvoiceDialog,
  VoidInvoiceDialog,
  WhtActions,
  WriteOffDialog,
} from '@/components/billing/invoice-actions';
import { InvoiceFormDialog } from '@/components/billing/invoice-form-dialog';
import { DownloadPdfButton } from '@/components/documents/document-actions';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatBpsAsPercent, formatMoney, whtExpectedOnBalance } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import { formatQuantity } from '@/lib/documents-display';
import { type InvoiceStatus, invoiceStatus, methodLabel, OPEN_INVOICE_STATUSES } from '@/lib/invoices-display';

// One invoice (08-billing-and-finance.md): what it charges, what has been paid, withheld and credited against it, and
// the actions its state and the viewer's permissions allow.

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const WHT_STATUS: Record<string, string> = {
  expected: 'Waiting for the certificate',
  certificate_received: 'Certificate received',
  disputed: 'Disputed',
  reversed: 'Reversed',
};

export function InvoicePage({ invoiceId, permissions }: { invoiceId: Id<'invoices'>; permissions: string[] }) {
  const router = useRouter();
  const invoice = useQuery(api.invoices.get, { invoiceId });
  const money = useQuery(api.payments.forInvoice, { invoiceId });
  const credits = useQuery(api.credits.forInvoice, { invoiceId });
  const held = useQuery(api.credits.forClient, invoice ? { clientId: invoice.clientId } : 'skip');
  const can = (key: string) => permissions.includes(key);

  if (invoice === undefined) return <p className="text-muted-foreground">Loading the invoice…</p>;

  const status = invoice.status as InvoiceStatus;
  const isDraft = status === 'draft';
  const open = OPEN_INVOICE_STATUSES.has(status);
  const hasMoney = invoice.paidMinor > 0 || invoice.whtCreditedMinor > 0 || invoice.creditedMinor > 0;
  const creditable = open || status === 'paid';
  const creditedSoFar = (credits?.creditNotes ?? []).reduce((sum, note) => sum + note.amountMinor, 0);
  const usableCredit = (held ?? []).filter((row) => row.currency === invoice.currency && row.remainingMinor > 0);
  const cur = (amount: number) => formatMoney(amount, invoice.currency);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Link
          href="/billing/invoices"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Invoices
        </Link>
        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold">{invoice.number ?? 'Draft invoice'}</h1>
            <ToneBadge {...invoiceStatus(status, invoice)} />
          </div>
          <p className="text-muted-foreground">
            {invoice.typeLabel} ·{' '}
            {can('clients.view') ? (
              <Link href={`/crm/clients/${invoice.clientId}`} className="underline underline-offset-4">
                {invoice.clientName}
              </Link>
            ) : (
              invoice.clientName
            )}
            {invoice.projectName && ` · ${invoice.projectName}`} · {invoice.currency}
          </p>
          <p className="text-sm text-muted-foreground">
            Drafted by {invoice.createdByName}
            {invoice.issueDate && ` · issued ${formatDay(invoice.issueDate)}`}
            {invoice.dueDate && ` · due ${formatDay(invoice.dueDate)}`}
            {!invoice.issueDate && ` · ${invoice.paymentTermsDays}-day terms from the day it is sent`}
          </p>
        </header>

        {invoice.voidReason && (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">Void: {invoice.voidReason}</p>
        )}
        {status === 'written_off' && (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            {cur(invoice.writtenOffMinor ?? 0)} written off: {invoice.writeOffReason}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {isDraft && can('invoices.send') && (
            <SendInvoiceDialog invoice={invoice} canSeeContacts={can('clients.view')} />
          )}
          {isDraft && can('invoices.update') && (
            <InvoiceFormDialog
              invoice={invoice}
              canUseRateCard={can('ratecard.view')}
              trigger={<Button variant="outline">Edit the draft</Button>}
            />
          )}
          {open && invoice.pdfFileId && can('invoices.send') && (
            <SendAgainDialog invoice={invoice} canSeeContacts={can('clients.view')} />
          )}
          {open && can('payments.record') && <RecordPaymentDialog invoice={invoice} />}
          {open && can('payments.record') && usableCredit.length > 0 && (
            <ApplyCreditDialog invoice={invoice} credits={usableCredit} />
          )}
          {creditable && can('creditnotes.create') && creditedSoFar < invoice.totals.totalMinor && (
            <CreditNoteDialog invoice={invoice} creditedSoFarMinor={creditedSoFar} />
          )}
          {invoice.pdfFileId && <DownloadPdfButton fileId={invoice.pdfFileId} />}
          {status === 'written_off' && can('invoices.writeoff') && <ReverseWriteOffButton invoice={invoice} />}
          {open && invoice.balanceMinor > 0 && can('invoices.writeoff') && <WriteOffDialog invoice={invoice} />}
          {open && !hasMoney && can('invoices.void') && <VoidInvoiceDialog invoice={invoice} />}
          {isDraft && !invoice.number && can('invoices.update') && (
            <DeleteDraftButton invoiceId={invoice.id} onDeleted={() => router.push('/billing/invoices')} />
          )}
        </div>
        {open && can('invoices.update') && <RemindersToggle invoice={invoice} />}
      </div>

      <section aria-labelledby="invoice-lines" className="space-y-3">
        <h2 id="invoice-lines" className="font-display text-xl font-bold">
          What it charges
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-xl text-sm">
            <caption className="sr-only">Invoice lines</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Description
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Qty
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Unit price
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-muted-foreground">
                    No lines yet.
                  </td>
                </tr>
              )}
              {invoice.lineItems.map((line, index) => (
                <tr key={index} className="border-t">
                  <td className="px-4 py-2.5">
                    {line.description}
                    {!line.taxable && invoice.vat.applies && <span className="text-muted-foreground"> (no VAT)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatQuantity(line.quantityMilli)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{cur(line.unitPriceMinor)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{cur(line.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto w-full max-w-sm space-y-1 text-sm">
          <Row label="Subtotal" value={cur(invoice.totals.subtotalMinor)} />
          {invoice.totals.discountMinor > 0 && <Row label="Discount" value={`−${cur(invoice.totals.discountMinor)}`} />}
          <Row label={vatLabel(invoice)} value={cur(invoice.vat.applies ? invoice.totals.vatMinor : 0)} />
          {invoice.vat.applies && invoice.lineItems.length > 0 && invoice.totals.taxableMinor === 0 && (
            <p role="status" className="pt-1 text-sm text-attention-foreground">
              No line carries VAT, so this invoice charges none. Untick “Charge VAT” if that is right.
            </p>
          )}
          <Row label="Total" value={cur(invoice.totals.totalMinor)} strong />
          {invoice.wht.applies && invoice.totals.whtExpectedMinor > 0 && (
            <Row
              label={`WHT the client may deduct (${formatBpsAsPercent(invoice.wht.bps)}%)`}
              value={cur(invoice.totals.whtExpectedMinor)}
              muted
            />
          )}
          {invoice.wht.applies && invoice.creditedMinor > 0 && invoice.balanceMinor > 0 && (
            <Row
              label="WHT on what is still owed"
              value={cur(whtExpectedOnBalance(invoice.totals, invoice.balanceMinor))}
              muted
            />
          )}
          {!isDraft && (
            <>
              {invoice.paidMinor > 0 && <Row label="Paid" value={`−${cur(invoice.paidMinor)}`} />}
              {invoice.whtCreditedMinor > 0 && <Row label="WHT withheld" value={`−${cur(invoice.whtCreditedMinor)}`} />}
              {invoice.creditedMinor > 0 && <Row label="Credited" value={`−${cur(invoice.creditedMinor)}`} />}
              <Row label="Still owed" value={cur(invoice.balanceMinor)} strong />
            </>
          )}
        </dl>
        {(invoice.notes || invoice.terms) && (
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            {invoice.notes && (
              <p>
                <span className="font-medium">Notes: </span>
                {invoice.notes}
              </p>
            )}
            {invoice.terms && (
              <p>
                <span className="font-medium">Terms: </span>
                {invoice.terms}
              </p>
            )}
          </div>
        )}
      </section>

      {!isDraft && money && (
        <section aria-labelledby="invoice-payments" className="space-y-3">
          <h2 id="invoice-payments" className="font-display text-xl font-bold">
            Payments
          </h2>
          {money.payments.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nothing paid yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {money.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {cur(payment.amountMinor)} · {methodLabel(payment.method, payment.instrument)}
                      {payment.refundedMinor > 0 && (
                        <span className="text-muted-foreground"> · {cur(payment.refundedMinor)} refunded</span>
                      )}
                    </p>
                    <p className="text-muted-foreground">
                      {formatDay(payment.receivedOn)}
                      {payment.reference && ` · ref ${payment.reference}`}
                      {payment.wht.length > 0 &&
                        ` · ${cur(payment.wht.reduce((sum, row) => sum + row.amountMinor, 0))} WHT withheld`}
                      {payment.receipt && ` · receipt ${payment.receipt.number}`}
                      {payment.receipt?.sentAt && ' emailed'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
                    {payment.receipt?.pdfFileId && (
                      <DownloadPdfButton fileId={payment.receipt.pdfFileId} label="Receipt" />
                    )}
                    {can('payments.refund') && payment.amountMinor > payment.refundedMinor && (
                      <RefundPaymentDialog
                        paymentId={payment.id}
                        refundableMinor={payment.amountMinor - payment.refundedMinor}
                        currency={payment.currency}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {money.refunds.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {money.refunds.map((refund) => (
                <li key={refund.id}>
                  Refunded {cur(refund.amountMinor)} by {methodLabel(refund.method).toLowerCase()}
                  {refund.processedAt ? ` on ${dateTime.format(refund.processedAt)}` : ''}: {refund.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {money && money.whtCredits.length > 0 && (
        <section aria-labelledby="invoice-wht" className="space-y-3">
          <h2 id="invoice-wht" className="font-display text-xl font-bold">
            Withholding tax
          </h2>
          <ul className="divide-y rounded-lg border">
            {money.whtCredits.map((credit) => (
              <li key={credit.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {cur(credit.amountMinor)} · {WHT_STATUS[credit.status]}
                  </p>
                  <p className="text-muted-foreground">
                    {credit.certificateNumber && `Certificate ${credit.certificateNumber}`}
                    {credit.disputeNote && `Disputed: ${credit.disputeNote}`}
                    {credit.reversedReason && `Reversed: ${credit.reversedReason}`}
                  </p>
                </div>
                {can('payments.record') && (
                  <div className="sm:ml-auto">
                    <WhtActions whtCreditId={credit.id} status={credit.status} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {credits && (credits.creditNotes.length > 0 || credits.appliedCredit.length > 0) && (
        <section aria-labelledby="invoice-credits" className="space-y-3">
          <h2 id="invoice-credits" className="font-display text-xl font-bold">
            Credits
          </h2>
          <ul className="divide-y rounded-lg border">
            {credits.creditNotes.map((note) => (
              <li key={note.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {note.number} · {cur(note.amountMinor)}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDay(note.issueDate)} · {note.reason} · {cur(note.appliedToInvoiceMinor)} applied here
                    {note.heldMinor > 0 && `, ${cur(note.heldMinor)} held as client credit`}
                  </p>
                </div>
                {note.pdfFileId && (
                  <div className="sm:ml-auto">
                    <DownloadPdfButton fileId={note.pdfFileId} label="Credit note" />
                  </div>
                )}
              </li>
            ))}
            {credits.appliedCredit.map((row) => (
              <li key={row.id} className="p-3 text-sm">
                <p className="font-medium">{cur(row.amountMinor)} of held credit applied</p>
                <p className="text-muted-foreground">{dateTime.format(row.appliedAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** "VAT at 7.5%" when it is charged; otherwise why it is zero. */
function vatLabel(invoice: { vat: { applies: boolean; bps: number }; vatTreatment?: string }) {
  if (invoice.vat.applies) return `VAT at ${formatBpsAsPercent(invoice.vat.bps)}%`;
  if (invoice.vatTreatment === 'zero_rated') return 'VAT (zero-rated)';
  if (invoice.vatTreatment === 'exempt') return 'VAT (exempt)';
  return 'VAT';
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-4 ${strong ? 'border-t pt-1 font-medium' : ''} ${muted ? 'text-muted-foreground' : ''}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
