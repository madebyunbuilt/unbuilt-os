'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { formatBpsAsPercent, parsePercentToBps } from '@/convex/lib/money';
import { VENDOR_KINDS } from '@/lib/bills-display';

// Vendors (08-billing-and-finance.md, Vendors and bills): who the studio pays, what it must withhold when it pays
// them, and where the money goes. Bank details only reach the people the server lets read them.

type Vendor = (typeof api.vendors.list._returnType)[number];

function VendorFormDialog({ vendor, trigger }: { vendor?: Vendor; trigger: ReactNode }) {
  const create = useMutation(api.vendors.create);
  const update = useMutation(api.vendors.update);
  const [name, setName] = useState(vendor?.name ?? '');
  const [kind, setKind] = useState(vendor?.kind ?? 'contractor');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [tin, setTin] = useState(vendor?.tin ?? '');
  const [wht, setWht] = useState(vendor?.whtBps ? formatBpsAsPercent(vendor.whtBps) : '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [bankName, setBankName] = useState(vendor?.bankDetails?.bankName ?? '');
  const [accountName, setAccountName] = useState(vendor?.bankDetails?.accountName ?? '');
  const [accountNumber, setAccountNumber] = useState(vendor?.bankDetails?.accountNumber ?? '');

  return (
    <FormDialog
      trigger={trigger}
      title={vendor ? 'Change this vendor' : 'Add a vendor'}
      description="A contractor or supplier the studio pays. The withholding rate is what the studio must deduct and remit on their behalf."
      submitLabel={vendor ? 'Save' : 'Add'}
      canSubmit={name.trim().length > 0}
      onSubmit={async () => {
        const details = {
          name,
          kind: kind as 'contractor',
          email: email || undefined,
          phone: phone || undefined,
          tin: tin || undefined,
          whtBps: wht.trim() ? parsePercentToBps(wht) : undefined,
          notes: notes || undefined,
          bankDetails: bankName && accountName && accountNumber ? { bankName, accountName, accountNumber } : undefined,
        };
        if (vendor) await update({ vendorId: vendor.id, ...details });
        else await create(details);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="vendor-name">Name</Label>
          <Input id="vendor-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vendor-kind">What they are</Label>
          <NativeSelect id="vendor-kind" value={kind} onChange={(event) => setKind(event.target.value as 'contractor')}>
            {VENDOR_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="vendor-email">Email</Label>
          <Input id="vendor-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vendor-phone">Phone</Label>
          <Input id="vendor-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="vendor-tin">TIN</Label>
          <Input id="vendor-tin" value={tin} onChange={(event) => setTin(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vendor-wht">Withholding rate (%)</Label>
          <Input id="vendor-wht" inputMode="decimal" value={wht} onChange={(event) => setWht(event.target.value)} />
          <p className="text-sm text-muted-foreground">
            Deducted from what they are paid, before their VAT. Leave it empty to withhold nothing.
          </p>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Where the money goes</legend>
        <div className="space-y-2">
          <Label htmlFor="vendor-bank">Bank</Label>
          <Input id="vendor-bank" value={bankName} onChange={(event) => setBankName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vendor-account-name">Account name</Label>
          <Input
            id="vendor-account-name"
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vendor-account-number">Account number</Label>
          <Input
            id="vendor-account-number"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
          />
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="vendor-notes">Notes</Label>
        <Textarea id="vendor-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </FormDialog>
  );
}

function ArchiveVendorButton({ vendor }: { vendor: Vendor }) {
  const setStatus = useMutation(api.vendors.setStatus);
  const archiving = vendor.status === 'active';
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost">{archiving ? 'Archive' : 'Bring back'}</Button>}
      title={archiving ? `Archive ${vendor.name}` : `Bring ${vendor.name} back`}
      description={
        archiving
          ? 'They take no new bills. Everything already paid to them stays on record.'
          : 'They can be billed against again.'
      }
      confirmLabel={archiving ? 'Archive' : 'Bring back'}
      onConfirm={() => setStatus({ vendorId: vendor.id, status: archiving ? 'archived' : 'active' })}
    />
  );
}

export function VendorList() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const vendors = useQuery(api.vendors.list, { includeArchived: includeArchived || undefined });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="vendor-filter" className="text-xs text-muted-foreground">
            Show
          </Label>
          <NativeSelect
            id="vendor-filter"
            value={includeArchived ? 'all' : 'active'}
            onChange={(event) => setIncludeArchived(event.target.value === 'all')}
          >
            <option value="active">Active</option>
            <option value="all">Including archived</option>
          </NativeSelect>
        </div>
        <div className="sm:ml-auto">
          <VendorFormDialog
            trigger={
              <Button>
                <Plus aria-hidden />
                Add a vendor
              </Button>
            }
          />
        </div>
      </div>

      {vendors === undefined ? (
        <p className="text-muted-foreground">Loading vendors…</p>
      ) : vendors.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          No vendors yet. Add the contractors and suppliers the studio pays.
        </p>
      ) : (
        <ul className="space-y-3">
          {vendors.map((vendor) => (
            <li key={vendor.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {vendor.name}
                    {vendor.status === 'archived' && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">Archived</span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {vendor.kind === 'contractor' ? 'Contractor' : 'Supplier'}
                    {vendor.email ? ` · ${vendor.email}` : ''}
                    {vendor.tin ? ` · TIN ${vendor.tin}` : ''}
                  </p>
                </div>
                <p className="text-sm">
                  {vendor.whtBps ? (
                    <>Withhold {formatBpsAsPercent(vendor.whtBps)}%</>
                  ) : (
                    <span className="text-muted-foreground">Withhold nothing</span>
                  )}
                </p>
              </div>

              <p className="mt-2 text-sm text-muted-foreground">
                {vendor.bankDetails ? (
                  <>
                    {vendor.bankDetails.bankName} · {vendor.bankDetails.accountName} ·{' '}
                    {vendor.bankDetails.accountNumber}
                  </>
                ) : vendor.hasBankDetails ? (
                  'Bank details on file, which your role does not open.'
                ) : (
                  'No bank details yet.'
                )}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <VendorFormDialog vendor={vendor} trigger={<Button variant="outline">Change</Button>} />
                <ArchiveVendorButton vendor={vendor} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
