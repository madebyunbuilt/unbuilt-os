'use client';

import { useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput, whtExpectedOnBalance, whtForPayment } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { toAmountInput } from '@/lib/crm-display';
import { lagosToday, PAYMENT_METHODS, type PaymentMethod } from '@/lib/invoices-display';

// The things that can be done to an invoice (08-billing-and-finance.md). Each is the one action its permission allows;
// the page decides which to show, and the server checks again.

type Invoice = NonNullable<typeof api.invoices.get._returnType>;

/** A form in a dialog, with its own error and busy state. */
function FormDialog({
  trigger,
  title,
  description,
  submitLabel,
  canSubmit = true,
  onSubmit,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  submitLabel: string;
  canSubmit?: boolean;
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = `form-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          id={id}
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            try {
              await onSubmit();
              setOpen(false);
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          {children}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={id} disabled={saving || !canSubmit}>
            {saving ? 'Working…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  currency,
  hint,
  warning,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  currency: Currency;
  hint?: string;
  /** Shows the hint as a problem to fix. */
  warning?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label} ({currency})
      </Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
      {hint && (
        <p
          id={`${id}-hint`}
          role={warning ? 'alert' : undefined}
          className={`text-sm ${warning ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/** Sending: to the billing contacts by default, or the people chosen. */
export function SendInvoiceDialog({ invoice, canSeeContacts }: { invoice: Invoice; canSeeContacts: boolean }) {
  const send = useMutation(api.invoices.send);
  const contacts = useQuery(api.contacts.listForClient, canSeeContacts ? { clientId: invoice.clientId } : 'skip');
  const active = (contacts ?? []).filter((contact) => contact.status === 'active');
  const defaults = active.some((contact) => contact.isBilling)
    ? active.filter((contact) => contact.isBilling)
    : active.filter((contact) => contact.isPrimary);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const selected = chosen ?? defaults.map((contact) => contact.id);
  const [message, setMessage] = useState('');
  return (
    <FormDialog
      trigger={<Button>Send the invoice</Button>}
      title="Send the invoice"
      description="It gets its number and dates, is frozen, and goes out as a PDF with your bank details. It cannot be edited afterwards."
      submitLabel="Send"
      onSubmit={() =>
        send({
          invoiceId: invoice.id,
          contactIds: chosen ? (selected as Id<'contacts'>[]) : undefined,
          message: message || undefined,
        })
      }
    >
      {canSeeContacts && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Send it to</legend>
          {active.length === 0 && <p className="text-sm text-muted-foreground">This client has no active contacts.</p>}
          {active.map((contact) => (
            <div key={contact.id} className="flex items-center gap-2">
              <Checkbox
                id={`invoice-to-${contact.id}`}
                checked={selected.includes(contact.id)}
                onCheckedChange={(value) =>
                  setChosen(value === true ? [...selected, contact.id] : selected.filter((id) => id !== contact.id))
                }
              />
              <Label htmlFor={`invoice-to-${contact.id}`} className="font-normal">
                {contact.name} <span className="text-muted-foreground">· {contact.email}</span>
                {contact.isBilling && <span className="text-muted-foreground"> · billing</span>}
              </Label>
            </div>
          ))}
        </fieldset>
      )}
      <div className="space-y-2">
        <Label htmlFor="invoice-message">A note with it (optional)</Label>
        <Textarea id="invoice-message" rows={3} value={message} onChange={(event) => setMessage(event.target.value)} />
      </div>
    </FormDialog>
  );
}

/** Sending the same invoice again: it went to spam, or somebody new needs it. Nothing about the invoice changes. */
export function SendAgainDialog({ invoice, canSeeContacts }: { invoice: Invoice; canSeeContacts: boolean }) {
  const sendAgain = useMutation(api.invoices.sendAgain);
  const contacts = useQuery(api.contacts.listForClient, canSeeContacts ? { clientId: invoice.clientId } : 'skip');
  const active = (contacts ?? []).filter((contact) => contact.status === 'active');
  // Whoever received it last, so the usual case is one press.
  const lastTime = (invoice.recipientContactIds ?? []) as string[];
  const defaults = active.filter((contact) =>
    lastTime.length > 0 ? lastTime.includes(contact.id) : contact.isBilling || contact.isPrimary,
  );
  const [chosen, setChosen] = useState<string[] | null>(null);
  const selected = chosen ?? defaults.map((contact) => contact.id);
  const [message, setMessage] = useState('');
  return (
    <FormDialog
      trigger={<Button variant="outline">Send again</Button>}
      title="Send this invoice again"
      description="The same invoice goes out: the same number, dates, amounts and PDF. The email says it is a copy, and the pay link is the one it has always had."
      submitLabel="Send again"
      onSubmit={() =>
        sendAgain({
          invoiceId: invoice.id,
          contactIds: chosen ? (selected as Id<'contacts'>[]) : undefined,
          message: message || undefined,
        })
      }
    >
      {canSeeContacts && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Send it to</legend>
          {active.length === 0 && <p className="text-sm text-muted-foreground">This client has no active contacts.</p>}
          {active.map((contact) => (
            <div key={contact.id} className="flex items-center gap-2">
              <Checkbox
                id={`invoice-again-${contact.id}`}
                checked={selected.includes(contact.id)}
                onCheckedChange={(value) =>
                  setChosen(value === true ? [...selected, contact.id] : selected.filter((id) => id !== contact.id))
                }
              />
              <Label htmlFor={`invoice-again-${contact.id}`} className="font-normal">
                {contact.name} <span className="text-muted-foreground">· {contact.email}</span>
                {lastTime.includes(contact.id) && <span className="text-muted-foreground"> · had it before</span>}
              </Label>
            </div>
          ))}
        </fieldset>
      )}
      <div className="space-y-2">
        <Label htmlFor="invoice-again-message">A note with it (optional)</Label>
        <Textarea
          id="invoice-again-message"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </div>
    </FormDialog>
  );
}

/**
 * Recording money received. When the client deducts WHT and nothing is paid yet, the form starts at what they would
 * send (total less the expected WHT) with the WHT filled in.
 */
export function RecordPaymentDialog({ invoice }: { invoice: Invoice }) {
  const record = useMutation(api.payments.record);
  const expectsWht = invoice.wht.applies && invoice.paidMinor === 0 && invoice.whtCreditedMinor === 0;
  // What they would withhold on what is left, not the whole invoice, once part has been credited.
  const whtDefault = expectsWht ? whtExpectedOnBalance(invoice.totals, invoice.balanceMinor) : 0;
  const [amount, setAmount] = useState(toAmountInput(invoice.balanceMinor - whtDefault));
  const [wht, setWht] = useState(whtDefault ? toAmountInput(whtDefault) : '');
  // The WHT follows the amount, in the invoice's proportion, until the person types their own figure.
  const [whtTyped, setWhtTyped] = useState(false);
  const [showWht, setShowWht] = useState(invoice.wht.applies);
  const followAmount = (value: string) => {
    setAmount(value);
    if (whtTyped || !invoice.wht.applies) return;
    try {
      const cash = parseMoneyInput(value || '0', invoice.currency);
      const withheld = whtForPayment(cash, invoice.totals, invoice.balanceMinor);
      setWht(withheld ? toAmountInput(withheld) : '');
    } catch {
      // Half-typed amounts leave the WHT as it was.
    }
  };
  const [receivedOn, setReceivedOn] = useState(lagosToday());
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [emailReceipt, setEmailReceipt] = useState(true);
  return (
    <FormDialog
      trigger={<Button>Record a payment</Button>}
      title="Record a payment"
      description={`${formatMoney(invoice.balanceMinor, invoice.currency)} is still owed. A receipt is made for every payment.`}
      submitLabel="Record it"
      onSubmit={() =>
        record({
          invoiceId: invoice.id,
          amountMinor: parseMoneyInput(amount, invoice.currency),
          whtDeductedMinor: showWht && wht.trim() ? parseMoneyInput(wht, invoice.currency) : 0,
          receivedOn,
          method,
          reference: reference || undefined,
          notes: notes || undefined,
          emailReceipt,
        })
      }
    >
      <MoneyField
        id="payment-amount"
        label="Amount received"
        value={amount}
        onChange={followAmount}
        currency={invoice.currency}
      />
      {showWht ? (
        <MoneyField
          id="payment-wht"
          label="WHT the client withheld"
          value={wht}
          onChange={(value) => {
            setWhtTyped(true);
            setWht(value);
          }}
          currency={invoice.currency}
          hint={
            invoice.wht.applies
              ? 'Worked out from the amount; change it to match the client’s remittance advice. Leave empty if they paid in full.'
              : 'Only if the client withheld tax from this payment.'
          }
        />
      ) : (
        // This client does not deduct WHT; the box is one click away for the rare time one does.
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => setShowWht(true)}>
          The client withheld tax
        </Button>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="payment-date">Received on</Label>
          <Input
            id="payment-date"
            type="date"
            max={lagosToday()}
            value={receivedOn}
            onChange={(event) => setReceivedOn(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="payment-method">How</Label>
          <NativeSelect
            id="payment-method"
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
      </div>
      <div className="space-y-2">
        <Label htmlFor="payment-reference">Reference (optional)</Label>
        <Input id="payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="payment-notes">Notes (optional)</Label>
        <Textarea id="payment-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="payment-email"
          checked={emailReceipt}
          onCheckedChange={(value) => setEmailReceipt(value === true)}
        />
        <Label htmlFor="payment-email" className="font-normal">
          Email the receipt to the billing contacts
        </Label>
      </div>
    </FormDialog>
  );
}

/** A credit note for one amount including VAT; anything beyond what is still owed is held as client credit. */
export function CreditNoteDialog({ invoice, creditedSoFarMinor }: { invoice: Invoice; creditedSoFarMinor: number }) {
  const create = useMutation(api.credits.create);
  const most = invoice.totals.totalMinor - creditedSoFarMinor;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState(true);
  // The limit comes first: nothing above the invoice's total (less earlier credits) can be credited at all. Only below
  // it does a credit bigger than what is owed split into cleared and held.
  let hint = '';
  let overLimit = false;
  try {
    const minor = amount.trim() ? parseMoneyInput(amount, invoice.currency) : 0;
    if (minor > most) {
      overLimit = true;
      hint = `At most ${formatMoney(most, invoice.currency)} can be credited on this invoice.`;
    } else if (minor > invoice.balanceMinor) {
      hint = `${formatMoney(invoice.balanceMinor, invoice.currency)} clears what is owed; ${formatMoney(minor - invoice.balanceMinor, invoice.currency)} is held as the client’s credit.`;
    }
  } catch {
    hint = '';
  }
  return (
    <FormDialog
      trigger={<Button variant="outline">Issue a credit note</Button>}
      title="Issue a credit note"
      description={`It corrects what this invoice charged. Up to ${formatMoney(most, invoice.currency)} can be credited; VAT is reversed in the same proportion as the invoice.`}
      submitLabel="Issue it"
      canSubmit={reason.trim().length > 0 && amount.trim().length > 0 && !overLimit}
      onSubmit={() =>
        create({
          invoiceId: invoice.id,
          reason,
          amountMinor: parseMoneyInput(amount, invoice.currency),
          emailCreditNote: email,
        })
      }
    >
      <MoneyField
        id="credit-amount"
        label="Amount to credit, including VAT"
        value={amount}
        onChange={setAmount}
        currency={invoice.currency}
        hint={hint || undefined}
        warning={overLimit}
      />
      <div className="space-y-2">
        <Label htmlFor="credit-reason">Why</Label>
        <Textarea id="credit-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="credit-email" checked={email} onCheckedChange={(value) => setEmail(value === true)} />
        <Label htmlFor="credit-email" className="font-normal">
          Email the credit note to the billing contacts
        </Label>
      </div>
    </FormDialog>
  );
}

function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const id = `reason-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <ConfirmDialog
      trigger={trigger}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      canConfirm={reason.trim().length > 0}
      onConfirm={() => onConfirm(reason)}
    >
      <div className="space-y-2">
        <Label htmlFor={id}>Why</Label>
        <Textarea id={id} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

export function VoidInvoiceDialog({ invoice }: { invoice: Invoice }) {
  const voidInvoice = useMutation(api.invoices.voidInvoice);
  return (
    <ReasonDialog
      trigger={<Button variant="ghost">Void</Button>}
      title={`Void ${invoice.number}?`}
      description="It keeps its number and stays on record, but nothing is owed on it. Only possible while nothing has been paid or credited."
      confirmLabel="Void it"
      onConfirm={(reason) => voidInvoice({ invoiceId: invoice.id, reason })}
    />
  );
}

export function WriteOffDialog({ invoice }: { invoice: Invoice }) {
  const writeOff = useMutation(api.invoices.writeOff);
  return (
    <ReasonDialog
      trigger={<Button variant="ghost">Write off</Button>}
      title={`Write off ${formatMoney(invoice.balanceMinor, invoice.currency)}?`}
      description="What is still owed moves to bad debt. Payments already made stay. You can reverse it if the client pays later."
      confirmLabel="Write it off"
      onConfirm={(reason) => writeOff({ invoiceId: invoice.id, reason })}
    />
  );
}

export function ReverseWriteOffButton({ invoice }: { invoice: Invoice }) {
  const reverse = useMutation(api.invoices.reverseWriteOff);
  return (
    <ConfirmDialog
      trigger={<Button variant="outline">Reverse the write-off</Button>}
      title="Reverse the write-off?"
      description={`${formatMoney(invoice.writtenOffMinor ?? 0, invoice.currency)} is owed again, so payments can be recorded.`}
      confirmLabel="Reverse it"
      onConfirm={() => reverse({ invoiceId: invoice.id })}
    />
  );
}

export function DeleteDraftButton({ invoiceId, onDeleted }: { invoiceId: Id<'invoices'>; onDeleted: () => void }) {
  const remove = useMutation(api.invoices.remove);
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost">Delete the draft</Button>}
      title="Delete this draft?"
      description="It was never sent, so nothing else changes."
      confirmLabel="Delete it"
      onConfirm={async () => {
        await remove({ invoiceId });
        onDeleted();
      }}
    />
  );
}

export function RefundPaymentDialog({
  paymentId,
  refundableMinor,
  currency,
}: {
  paymentId: Id<'payments'>;
  refundableMinor: number;
  currency: Currency;
}) {
  const refund = useMutation(api.payments.refund);
  const [amount, setAmount] = useState(toAmountInput(refundableMinor));
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          Refund
        </Button>
      }
      title="Refund this payment"
      description={`Up to ${formatMoney(refundableMinor, currency)}. The amount refunded is owed on the invoice again.`}
      submitLabel="Record the refund"
      canSubmit={reason.trim().length > 0}
      onSubmit={() =>
        refund({
          paymentId,
          amountMinor: parseMoneyInput(amount, currency),
          method,
          reference: reference || undefined,
          reason,
        })
      }
    >
      <MoneyField id="refund-amount" label="Amount" value={amount} onChange={setAmount} currency={currency} />
      <div className="space-y-2">
        <Label htmlFor="refund-method">How it went back</Label>
        <NativeSelect
          id="refund-method"
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
        <Label htmlFor="refund-reference">Reference (optional)</Label>
        <Input id="refund-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="refund-reason">Why</Label>
        <Textarea id="refund-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </FormDialog>
  );
}

export function WhtActions({ whtCreditId, status }: { whtCreditId: Id<'whtCredits'>; status: string }) {
  const received = useMutation(api.payments.markCertificateReceived);
  const dispute = useMutation(api.payments.markDisputed);
  const reverse = useMutation(api.payments.reverseWht);
  const [number, setNumber] = useState('');
  if (status === 'reversed') return null;
  return (
    <div className="flex flex-wrap gap-1">
      {status !== 'certificate_received' && (
        <FormDialog
          trigger={
            <Button variant="ghost" size="sm">
              Certificate received
            </Button>
          }
          title="WHT certificate received"
          description="Record the credit note the client sent for this deduction."
          submitLabel="Save"
          onSubmit={async () => {
            const result = await received({ whtCreditId, certificateNumber: number || undefined });
            if (!result.ok) throw new Error(result.message);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="wht-number">Certificate number (optional)</Label>
            <Input id="wht-number" value={number} onChange={(event) => setNumber(event.target.value)} />
          </div>
        </FormDialog>
      )}
      {status === 'expected' && (
        <ReasonDialog
          trigger={
            <Button variant="ghost" size="sm">
              Dispute
            </Button>
          }
          title="Flag this WHT for follow-up?"
          description="Nothing changes on the invoice until you reverse it."
          confirmLabel="Flag it"
          onConfirm={(note) => dispute({ whtCreditId, note })}
        />
      )}
      {status === 'disputed' && (
        <ReasonDialog
          trigger={
            <Button variant="ghost" size="sm">
              Reverse
            </Button>
          }
          title="Reverse this WHT deduction?"
          description="The amount goes back onto the invoice as owed, and the invoice reopens."
          confirmLabel="Reverse it"
          onConfirm={(reason) => reverse({ whtCreditId, reason })}
        />
      )}
    </div>
  );
}

/** Applies a client's held credit, in this invoice's currency, to what it still owes. */
export function ApplyCreditDialog({
  invoice,
  credits,
}: {
  invoice: Invoice;
  credits: { id: Id<'clientCredits'>; remainingMinor: number; creditNoteNumber?: string }[];
}) {
  const apply = useMutation(api.credits.apply);
  const [creditId, setCreditId] = useState<string>(credits[0]?.id ?? '');
  const credit = credits.find((row) => row.id === creditId);
  const most = Math.min(credit?.remainingMinor ?? 0, invoice.balanceMinor);
  const [amount, setAmount] = useState(toAmountInput(most));
  return (
    <FormDialog
      trigger={<Button variant="outline">Apply held credit</Button>}
      title="Apply held credit"
      description="Takes it off what this invoice still owes."
      submitLabel="Apply it"
      onSubmit={() =>
        apply({
          clientCreditId: creditId as Id<'clientCredits'>,
          invoiceId: invoice.id,
          amountMinor: parseMoneyInput(amount, invoice.currency),
        })
      }
    >
      <div className="space-y-2">
        <Label htmlFor="apply-credit">Credit</Label>
        <NativeSelect id="apply-credit" value={creditId} onChange={(event) => setCreditId(event.target.value)}>
          {credits.map((row) => (
            <option key={row.id} value={row.id}>
              {formatMoney(row.remainingMinor, invoice.currency)}
              {row.creditNoteNumber ? ` from ${row.creditNoteNumber}` : ''}
            </option>
          ))}
        </NativeSelect>
      </div>
      <MoneyField id="apply-amount" label="Amount" value={amount} onChange={setAmount} currency={invoice.currency} />
    </FormDialog>
  );
}

export function RemindersToggle({ invoice }: { invoice: Invoice }) {
  const set = useMutation(api.billingChase.setInvoiceReminders);
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="invoice-reminders"
        checked={!invoice.noReminders}
        onCheckedChange={(value) => void set({ invoiceId: invoice.id, off: value !== true })}
      />
      <Label htmlFor="invoice-reminders" className="font-normal">
        Send payment reminders
      </Label>
    </div>
  );
}
