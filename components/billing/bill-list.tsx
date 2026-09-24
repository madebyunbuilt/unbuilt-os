'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { BILL_STATUSES, type BillStatus, billStatus } from '@/lib/bills-display';
import { formatDay, toAmountInput } from '@/lib/crm-display';
import { lagosToday } from '@/lib/invoices-display';

// Bills (08-billing-and-finance.md, Vendors and bills): what the studio owes, and paying it with the withholding tax
// the studio remits on the vendor's behalf deducted. The screen shows that deduction before anyone commits to it.

type Bill = (typeof api.bills.list._returnType)[number];

function BillFormDialog({ bill, trigger }: { bill?: Bill; trigger: ReactNode }) {
  const create = useMutation(api.bills.create);
  const update = useMutation(api.bills.update);
  const vendors = useQuery(api.vendors.list, {});
  const projects = useQuery(api.projects.list, {});
  const [vendorId, setVendorId] = useState(bill?.vendorId ?? '');
  const [reference, setReference] = useState(bill?.reference ?? '');
  const [description, setDescription] = useState(bill?.description ?? '');
  const [amount, setAmount] = useState(bill ? toAmountInput(bill.amountMinor) : '');
  const [vat, setVat] = useState(bill?.vatMinor ? toAmountInput(bill.vatMinor) : '');
  const [currency, setCurrency] = useState<Currency>((bill?.currency as Currency) ?? 'NGN');
  const [issueDate, setIssueDate] = useState(bill?.issueDate ?? lagosToday());
  const [dueDate, setDueDate] = useState(bill?.dueDate ?? lagosToday());
  const [projectId, setProjectId] = useState(bill?.projectId ?? '');

  return (
    <FormDialog
      trigger={trigger}
      title={bill ? 'Change this bill' : 'Add a bill'}
      description="What a vendor has invoiced the studio. Record their VAT separately: withholding is worked out on the rest."
      submitLabel={bill ? 'Save' : 'Add'}
      canSubmit={Boolean(vendorId) && reference.trim().length > 0 && amount.trim().length > 0}
      onSubmit={async () => {
        const details = {
          vendorId: vendorId as Id<'vendors'>,
          projectId: projectId ? (projectId as Id<'projects'>) : undefined,
          reference,
          description,
          amountMinor: parseMoneyInput(amount, currency),
          vatMinor: vat.trim() ? parseMoneyInput(vat, currency) : undefined,
          issueDate,
          dueDate,
        };
        if (bill) await update({ billId: bill.id, ...details });
        else await create({ ...details, currency });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="bill-vendor">Who it is from</Label>
        <NativeSelect id="bill-vendor" value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
          <option value="">Choose a vendor</option>
          {(vendors ?? []).map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bill-reference">Their invoice number</Label>
          <Input id="bill-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bill-project">Project (optional)</Label>
          <NativeSelect id="bill-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">No project</option>
            {(projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bill-description">What it is for</Label>
        <Textarea
          id="bill-description"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="bill-amount">Total</Label>
          <Input
            id="bill-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bill-vat">Of which VAT</Label>
          <Input id="bill-vat" inputMode="decimal" value={vat} onChange={(event) => setVat(event.target.value)} />
        </div>
        {!bill && (
          <div className="space-y-2">
            <Label htmlFor="bill-currency">Currency</Label>
            <NativeSelect
              id="bill-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              <option value="NGN">NGN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </NativeSelect>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bill-issued">Issued</Label>
          <Input
            id="bill-issued"
            type="date"
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bill-due">Due</Label>
          <Input id="bill-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>
      </div>
    </FormDialog>
  );
}

/** Paying: the deduction and what actually leaves the account are both shown before it is recorded. */
function PayBillDialog({ bill }: { bill: Bill }) {
  const pay = useMutation(api.bills.pay);
  const [paidOn, setPaidOn] = useState(lagosToday());
  const [reference, setReference] = useState('');
  const currency = bill.currency as Currency;
  return (
    <FormDialog
      trigger={<Button>Record the payment</Button>}
      title={`Pay ${bill.vendorName ?? 'this vendor'}`}
      description="Says the money has gone. The withholding tax is kept back for the studio to remit on their behalf."
      submitLabel="Record it"
      onSubmit={() => pay({ billId: bill.id, paidOn, paymentReference: reference || undefined })}
    >
      <dl className="space-y-1 rounded-md border p-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">The bill</dt>
          <dd className="tabular-nums">{formatMoney(bill.amountMinor, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Withheld, to remit</dt>
          <dd className="tabular-nums">{formatMoney(bill.whtMinor, currency)}</dd>
        </div>
        <div className="flex justify-between border-t pt-1 font-medium">
          <dt>They receive</dt>
          <dd className="tabular-nums">{formatMoney(bill.payableMinor, currency)}</dd>
        </div>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bill-paid-on">When it went</Label>
          <Input id="bill-paid-on" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bill-payment-reference">Reference</Label>
          <Input id="bill-payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>
      </div>
    </FormDialog>
  );
}

function ScheduleBillDialog({ bill }: { bill: Bill }) {
  const schedule = useMutation(api.bills.schedule);
  const [scheduledFor, setScheduledFor] = useState(bill.scheduledFor ?? bill.dueDate);
  return (
    <FormDialog
      trigger={<Button variant="outline">{bill.scheduledFor ? 'Move the date' : 'Schedule it'}</Button>}
      title="Schedule this payment"
      description="The day the studio means to pay it. Nothing is sent automatically."
      submitLabel="Schedule"
      onSubmit={() => schedule({ billId: bill.id, scheduledFor })}
    >
      <div className="space-y-2">
        <Label htmlFor="bill-scheduled-for">Pay it on</Label>
        <Input
          id="bill-scheduled-for"
          type="date"
          value={scheduledFor}
          onChange={(event) => setScheduledFor(event.target.value)}
        />
      </div>
    </FormDialog>
  );
}

function VoidBillDialog({ bill }: { bill: Bill }) {
  const voidBill = useMutation(api.bills.voidBill);
  const [reason, setReason] = useState('');
  return (
    <FormDialog
      trigger={<Button variant="ghost">Void</Button>}
      title="Void this bill"
      description="It stays on record with the reason, and is never paid."
      submitLabel="Void it"
      canSubmit={reason.trim().length > 0}
      onSubmit={() => voidBill({ billId: bill.id, reason })}
    >
      <div className="space-y-2">
        <Label htmlFor="bill-void-reason">Why</Label>
        <Textarea id="bill-void-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </FormDialog>
  );
}

export function BillList({ permissions }: { permissions: string[] }) {
  const canManage = permissions.includes('bills.manage');
  const canPay = permissions.includes('bills.pay');
  const approve = useMutation(api.bills.approve);
  const remove = useMutation(api.bills.remove);
  const [status, setStatus] = useState('all');
  const bills = useQuery(api.bills.list, { status: status === 'all' ? undefined : status });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="bill-status-filter" className="text-xs text-muted-foreground">
            Show
          </Label>
          <NativeSelect id="bill-status-filter" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Everything</option>
            {BILL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {billStatus(value).label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {canManage && (
          <div className="sm:ml-auto">
            <BillFormDialog
              trigger={
                <Button>
                  <Plus aria-hidden />
                  Add a bill
                </Button>
              }
            />
          </div>
        )}
      </div>

      {bills === undefined ? (
        <p className="text-muted-foreground">Loading bills…</p>
      ) : bills.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          Nothing here. Bills from contractors and suppliers appear on this page.
        </p>
      ) : (
        <ul className="space-y-3">
          {bills.map((bill) => {
            const currency = bill.currency as Currency;
            return (
              <li key={bill.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {bill.vendorName ?? 'Unknown vendor'} · {bill.reference}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {bill.description}
                      {bill.paidOn ? ` · paid ${formatDay(bill.paidOn)}` : ` · due ${formatDay(bill.dueDate)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">{formatMoney(bill.amountMinor, currency)}</p>
                    <ToneBadge {...billStatus(bill.status as BillStatus)} />
                  </div>
                </div>

                {bill.whtMinor > 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {bill.status === 'paid' ? 'Withheld' : 'Withholding'} {formatMoney(bill.whtMinor, currency)} —{' '}
                    {bill.vendorName ?? 'they'} {bill.status === 'paid' ? 'received' : 'receive'}{' '}
                    {formatMoney(bill.payableMinor, currency)}
                  </p>
                )}
                {bill.voidReason && (
                  <p className="mt-2 rounded-md border p-3 text-sm text-muted-foreground">{bill.voidReason}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {canManage && bill.status === 'draft' && (
                    <>
                      <Button onClick={() => void approve({ billId: bill.id })}>Approve it</Button>
                      <BillFormDialog bill={bill} trigger={<Button variant="outline">Change</Button>} />
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" className="text-destructive">
                            Delete
                          </Button>
                        }
                        title="Delete this bill"
                        description="It has not been approved, so nothing is kept."
                        confirmLabel="Delete"
                        onConfirm={() => remove({ billId: bill.id })}
                      />
                    </>
                  )}
                  {canPay && (bill.status === 'approved' || bill.status === 'scheduled') && (
                    <>
                      <PayBillDialog bill={bill} />
                      <ScheduleBillDialog bill={bill} />
                    </>
                  )}
                  {canManage && bill.status !== 'paid' && bill.status !== 'void' && <VoidBillDialog bill={bill} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
