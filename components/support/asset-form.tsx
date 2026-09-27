'use client';

import { useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { FormDialog } from '@/components/app/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, parseMoneyInput } from '@/convex/lib/money';
import { toAmountInput } from '@/lib/crm-display';
import { ASSET_TYPE_LABEL, type AssetType } from '@/lib/support-display';

// Adding or changing something the studio keeps alive for a client (09-support-and-sla.md). What it costs and what
// the client pays are asked for separately, because they are different numbers in different currencies.

type Asset = NonNullable<typeof api.assets.get._returnType>;

const CURRENCIES: Currency[] = ['NGN', 'USD', 'EUR'];

export function AssetForm({ asset, clientId, trigger }: { asset?: Asset; clientId?: string; trigger: ReactNode }) {
  const create = useMutation(api.assets.create);
  const update = useMutation(api.assets.update);
  const clients = useQuery(api.clients.list, asset ? 'skip' : {});
  const [client, setClient] = useState(asset?.clientId ?? clientId ?? '');
  const projects = useQuery(api.projects.list, client ? { clientId: client as Id<'clients'> } : 'skip');
  const [projectId, setProjectId] = useState(asset?.projectId ?? '');
  const [type, setType] = useState<AssetType>((asset?.type as AssetType) ?? 'domain');
  const [name, setName] = useState(asset?.name ?? '');
  const [provider, setProvider] = useState(asset?.provider ?? '');
  const [renewsOnDate, setRenewsOnDate] = useState(asset?.renewsOnDate ?? '');
  const [cost, setCost] = useState(asset ? toAmountInput(asset.costMinor) : '');
  const [costCurrency, setCostCurrency] = useState<Currency>((asset?.costCurrency as Currency) ?? 'NGN');
  const [price, setPrice] = useState(asset?.billPriceMinor ? toAmountInput(asset.billPriceMinor) : '');
  const [billCurrency, setBillCurrency] = useState<Currency>((asset?.billCurrency as Currency) ?? 'NGN');
  const [autoInvoice, setAutoInvoice] = useState(asset?.autoInvoice ?? false);
  const [notes, setNotes] = useState(asset?.notes ?? '');

  const billed = price.trim().length > 0;

  return (
    <FormDialog
      trigger={trigger}
      title={asset ? `Change ${asset.name}` : 'Add something to renew'}
      description="Unbuilt will say when it is due, and can draft the invoice for it."
      submitLabel={asset ? 'Save' : 'Add it'}
      canSubmit={Boolean(client) && name.trim().length > 0 && provider.trim().length > 0 && renewsOnDate.length === 10}
      onSubmit={async () => {
        const details = {
          projectId: projectId ? (projectId as Id<'projects'>) : undefined,
          type,
          name,
          provider,
          renewsOnDate,
          costMinor: cost.trim() ? parseMoneyInput(cost, costCurrency) : 0,
          costCurrency,
          billPriceMinor: billed ? parseMoneyInput(price, billCurrency) : undefined,
          billCurrency: billed ? billCurrency : undefined,
          autoInvoice: billed && autoInvoice,
          notes: notes.trim() ? notes : undefined,
        };
        if (asset) await update({ assetId: asset.id, ...details });
        else await create({ clientId: client as Id<'clients'>, ...details });
      }}
    >
      {!asset && (
        <div className="space-y-2">
          <Label htmlFor="asset-client">Client</Label>
          <NativeSelect
            id="asset-client"
            value={client}
            onChange={(event) => {
              setClient(event.target.value);
              setProjectId('');
            }}
          >
            <option value="">Choose a client</option>
            {(clients ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="asset-type">What it is</Label>
          <NativeSelect id="asset-type" value={type} onChange={(event) => setType(event.target.value as AssetType)}>
            {(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((value) => (
              <option key={value} value={value}>
                {ASSET_TYPE_LABEL[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="asset-renews">Renews on</Label>
          <Input
            id="asset-renews"
            type="date"
            value={renewsOnDate}
            onChange={(event) => setRenewsOnDate(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="asset-name">What to call it</Label>
        <Input id="asset-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="asset-provider">Who it is with</Label>
        <Input
          id="asset-provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          placeholder="Namecheap, Vercel, Apple"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="asset-project">Project</Label>
        <NativeSelect
          id="asset-project"
          value={projectId}
          disabled={!client}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">No particular project</option>
          {(projects ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">A project decides who is reminded when it comes due.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="asset-cost">What it costs Unbuilt</Label>
          <div className="flex gap-2">
            <Input id="asset-cost" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="0.00" />
            <NativeSelect
              aria-label="Cost currency"
              className="w-24"
              value={costCurrency}
              onChange={(event) => setCostCurrency(event.target.value as Currency)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="asset-price">What the client pays</Label>
          <div className="flex gap-2">
            <Input
              id="asset-price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="Leave empty if not billed on"
            />
            <NativeSelect
              aria-label="Price currency"
              className="w-24"
              value={billCurrency}
              onChange={(event) => setBillCurrency(event.target.value as Currency)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div>
          <Label htmlFor="asset-auto">Draft the invoice for me</Label>
          <p className="text-xs text-muted-foreground">
            {billed
              ? 'A draft invoice appears thirty days before the date, for you to check and send.'
              : 'Give a price the client pays, and Unbuilt can draft the renewal invoice for you.'}
          </p>
        </div>
        <Switch id="asset-auto" checked={billed && autoInvoice} disabled={!billed} onCheckedChange={setAutoInvoice} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="asset-notes">Anything worth remembering</Label>
        <Textarea id="asset-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </FormDialog>
  );
}
