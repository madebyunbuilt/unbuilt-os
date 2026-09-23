'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { formatBpsAsPercent, formatMoney } from '@/convex/lib/money';
import { paying, type PayPageInvoice } from '@/lib/pay-client';

// Paying an invoice from its emailed link (08-billing-and-finance.md, Paystack). The page never says an invoice is
// paid: pressing Pay opens Paystack, and the studio records the money only once Paystack's webhook confirms it, so a
// client returning here sees the new balance a moment later.

const longDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

export function PayPage({ token, returned }: { token: string; returned?: boolean }) {
  const [invoice, setInvoice] = useState<PayPageInvoice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [withholdWht, setWithholdWht] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const answer = await paying.view(token);
    if (answer.ok) setInvoice(answer.invoice);
    else setLoadError(answer.message);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    void paying.view(token).then((answer) => {
      if (cancelled) return;
      if (answer.ok) setInvoice(answer.invoice);
      else setLoadError(answer.message);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Back from Paystack: the webhook may still be on its way, so look again for a few seconds.
  useEffect(() => {
    if (!returned) return;
    const timer = setInterval(() => void load(), 3000);
    const stop = setTimeout(() => clearInterval(timer), 30000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [returned, load]);

  if (loadError) {
    return (
      <Notice title="This payment link does not work">
        {loadError} Ask whoever sent the invoice for a new link; the one in the most recent email is the one that works.
      </Notice>
    );
  }
  if (!invoice) return <p className="text-muted-foreground">Opening the invoice…</p>;

  const money = (amount: number) => formatMoney(amount, invoice.currency);
  const payMinor = invoice.balanceMinor - (withholdWht ? invoice.whtMinor : 0);

  if (!invoice.payable) {
    return (
      <Notice title={`${invoice.number} is settled`}>
        Nothing is owed on it. Thank you{invoice.clientName ? `, ${invoice.clientName}` : ''}.
      </Notice>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">{invoice.studioName}</p>
        <h1 className="font-display text-3xl font-bold">Invoice {invoice.number}</h1>
        <p className="text-muted-foreground">
          {money(invoice.balanceMinor)} still owed
          {invoice.dueDate ? `, due ${longDate.format(Date.parse(`${invoice.dueDate}T00:00:00Z`))}` : ''}.
        </p>
      </header>

      {returned && (
        <p role="status" className="rounded-md border p-3 text-sm">
          Thank you. We are confirming the payment with Paystack; this page updates on its own when it is through.
        </p>
      )}

      {invoice.byCard ? (
        <section className="space-y-4 rounded-lg border p-6">
          <h2 className="font-display text-xl font-bold">Pay by card or transfer</h2>
          {invoice.whtMinor > 0 && (
            <div className="flex items-start gap-3">
              <Checkbox
                id="withhold-wht"
                checked={withholdWht}
                onCheckedChange={(value) => setWithholdWht(value === true)}
              />
              <Label htmlFor="withhold-wht" className="font-normal leading-relaxed">
                We withhold tax at {formatBpsAsPercent(invoice.whtBps)}% ({money(invoice.whtMinor)}) and remit it
                ourselves. Pay {money(invoice.balanceMinor - invoice.whtMinor)} now and send {invoice.studioName} the
                WHT certificate.
              </Label>
            </div>
          )}
          <Button
            disabled={starting || payMinor <= 0}
            onClick={async () => {
              setStarting(true);
              setError(null);
              const answer = await paying.start(token, withholdWht);
              setStarting(false);
              if (answer.ok) window.location.href = answer.authorizationUrl;
              else setError(answer.message);
            }}
          >
            {starting ? 'Opening Paystack…' : `Pay ${money(payMinor)}`}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          This invoice is paid by bank transfer.
        </p>
      )}

      {invoice.bankAccounts.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-xl font-bold">Bank transfer</h2>
          <p className="text-sm text-muted-foreground">Please quote {invoice.number} as the reference.</p>
          <ul className="space-y-3 text-sm">
            {invoice.bankAccounts.map((account, index) => (
              <li key={index} className="rounded-md border p-3">
                <p className="font-medium">{account.bankName}</p>
                <p>{account.accountName}</p>
                <p>Account {account.accountNumber}</p>
                {account.swift && <p className="text-muted-foreground">SWIFT {account.swift}</p>}
                {account.iban && <p className="text-muted-foreground">IBAN {account.iban}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}
