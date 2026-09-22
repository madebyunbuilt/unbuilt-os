'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { InvoiceList } from '@/components/billing/invoice-list';
import { DownloadPdfButton } from '@/components/documents/document-actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { formatDay, toAmountInput } from '@/lib/crm-display';
import { lagosToday, PAYMENT_METHODS, type PaymentMethod } from '@/lib/invoices-display';

// A client's money (08-billing-and-finance.md): their invoices, any credit held for them, and their statement of
// account for a date range, on screen or as a PDF.

const startOfYear = () => `${lagosToday().slice(0, 4)}-01-01`;

export function ClientBilling({ clientId, permissions }: { clientId: Id<'clients'>; permissions: string[] }) {
  return (
    <div className="space-y-10">
      <InvoiceList permissions={permissions} clientId={clientId} heading="Invoices" />
      <HeldCredit clientId={clientId} permissions={permissions} />
      <Statement clientId={clientId} />
      {permissions.includes('invoices.update') && <ClientReminders clientId={clientId} />}
    </div>
  );
}

function HeldCredit({ clientId, permissions }: { clientId: Id<'clients'>; permissions: string[] }) {
  const credits = useQuery(api.credits.forClient, { clientId });
  if (!credits || credits.length === 0) return null;
  return (
    <section aria-labelledby="held-credit" className="space-y-3">
      <h2 id="held-credit" className="font-display text-xl font-bold">
        Credit held for this client
      </h2>
      <p className="text-sm text-muted-foreground">
        Apply it from an open invoice’s page, or pay it back to the client.
      </p>
      <ul className="divide-y rounded-lg border">
        {credits.map((credit) => (
          <li key={credit.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <p className="font-medium">
              {formatMoney(credit.remainingMinor, credit.currency)}
              {credit.creditNoteNumber && (
                <span className="text-muted-foreground"> from {credit.creditNoteNumber}</span>
              )}
            </p>
            {permissions.includes('payments.refund') && (
              <div className="sm:ml-auto">
                <RefundCreditDialog
                  creditId={credit.id}
                  remainingMinor={credit.remainingMinor}
                  currency={credit.currency}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RefundCreditDialog({
  creditId,
  remainingMinor,
  currency,
}: {
  creditId: Id<'clientCredits'>;
  remainingMinor: number;
  currency: Currency;
}) {
  const refund = useMutation(api.credits.refund);
  const [amount, setAmount] = useState(toAmountInput(remainingMinor));
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          Pay it back
        </Button>
      }
      title="Pay held credit back"
      description={`Up to ${formatMoney(remainingMinor, currency)}. No invoice changes: the credit note already corrected it.`}
      confirmLabel="Record the refund"
      canConfirm={reason.trim().length > 0}
      onConfirm={() =>
        refund({
          clientCreditId: creditId,
          amountMinor: parseMoneyInput(amount, currency),
          method,
          reference: reference || undefined,
          reason,
        })
      }
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="credit-refund-amount">Amount ({currency})</Label>
          <Input id="credit-refund-amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="credit-refund-method">How it went back</Label>
          <NativeSelect
            id="credit-refund-method"
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="credit-refund-reference">Reference (optional)</Label>
          <Input
            id="credit-refund-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="credit-refund-reason">Why</Label>
          <Textarea
            id="credit-refund-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}

function Statement({ clientId }: { clientId: Id<'clients'> }) {
  const [fromDate, setFromDate] = useState(startOfYear());
  const [toDate, setToDate] = useState(lagosToday());
  const valid = fromDate && toDate && fromDate <= toDate;
  const sections = useQuery(api.statements.forClient, valid ? { clientId, fromDate, toDate } : 'skip');
  const pdfs = useQuery(api.statements.listPdfs, { clientId });
  const requestPdf = useMutation(api.statements.requestPdf);
  const [asking, setAsking] = useState(false);

  return (
    <section aria-labelledby="statement" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <h2 id="statement" className="font-display text-xl font-bold">
          Statement of account
        </h2>
        <div className="space-y-1">
          <Label htmlFor="statement-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="statement-from"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="statement-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input id="statement-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>
        <Button
          variant="outline"
          disabled={!valid || asking}
          onClick={async () => {
            setAsking(true);
            try {
              await requestPdf({ clientId, fromDate, toDate });
            } finally {
              setAsking(false);
            }
          }}
        >
          Make a PDF
        </Button>
      </div>
      {!valid && <p className="text-sm text-destructive">The start date is after the end date.</p>}
      {valid && sections === undefined && <p className="text-muted-foreground">Working it out…</p>}
      {sections && sections.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nothing on the account yet.</p>
      )}
      {sections?.map((section) => {
        const money = (amount: number) =>
          amount < 0 ? `${formatMoney(-amount, section.currency)} in credit` : formatMoney(amount, section.currency);
        return (
          <div key={section.currency} className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-2xl text-sm">
              <caption className="px-4 pt-3 text-left font-medium">{section.currency}</caption>
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Details
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Charged
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Paid or credited
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-4 py-2">{formatDay(fromDate)}</td>
                  <td className="px-4 py-2 text-muted-foreground">Opening balance</td>
                  <td />
                  <td />
                  <td className="px-4 py-2 text-right tabular-nums">{money(section.openingMinor)}</td>
                </tr>
                {section.lines.map((line, index) => (
                  <tr key={index} className="border-t">
                    <td className="px-4 py-2">{formatDay(line.date)}</td>
                    <td className="px-4 py-2">{line.description}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {line.debitMinor ? formatMoney(line.debitMinor, section.currency) : ''}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {line.creditMinor ? formatMoney(line.creditMinor, section.currency) : ''}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(line.balanceMinor)}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="px-4 py-2" colSpan={4}>
                    Closing balance on {formatDay(toDate)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(section.closingMinor)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      {pdfs && pdfs.length > 0 && (
        <ul className="space-y-2 text-sm">
          {pdfs.map((pdf) => (
            <li key={pdf.id} className="flex flex-wrap items-center gap-3">
              <span>
                {formatDay(pdf.fromDate)} to {formatDay(pdf.toDate)}
              </span>
              {pdf.status === 'rendering' && <span className="text-muted-foreground">Being made…</span>}
              {pdf.status === 'failed' && <span className="text-destructive">Could not be made: {pdf.failure}</span>}
              {pdf.status === 'ready' && pdf.fileId && <DownloadPdfButton fileId={pdf.fileId} label="Download" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClientReminders({ clientId }: { clientId: Id<'clients'> }) {
  const client = useQuery(api.clients.get, { clientId });
  const set = useMutation(api.billingChase.setClientReminders);
  if (!client) return null;
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="client-reminders"
        checked={!client.noReminders}
        onCheckedChange={(value) => void set({ clientId, off: value !== true })}
      />
      <Label htmlFor="client-reminders" className="font-normal">
        Send this client payment reminders
      </Label>
    </div>
  );
}
