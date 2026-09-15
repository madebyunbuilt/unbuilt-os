'use client';

import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { SaveStatus } from '@/components/settings/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatBpsAsPercent, parsePercentToBps } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { VAT_TREATMENT_LABELS } from '@/lib/crm-display';

type Client = NonNullable<typeof api.clients.get._returnType>;
type SaveState = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string };

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4 border-t pt-8 first:border-t-0 first:pt-0">
      <div>
        <h2 id={id} className="font-display text-xl font-bold">
          {title}
        </h2>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function ClientSettings({ clientId, permissions }: { clientId: Id<'clients'>; permissions: string[] }) {
  const client = useQuery(api.clients.get, { clientId });
  if (client === undefined) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="max-w-3xl space-y-8">
      <Section
        id="billing-heading"
        title="Billing details"
        description="Used on invoices. VAT treatment and WHT decide the tax on every invoice to this client."
      >
        <BillingForm key={JSON.stringify(client)} client={client} editable={permissions.includes('invoices.update')} />
      </Section>
      <Section
        id="sla-heading"
        title="Support"
        description="The SLA policy applies to tickets for this client's projects that have none of their own."
      >
        <SlaPolicy client={client} editable={permissions.includes('clients.update')} />
      </Section>
      <Section id="portal-heading" title="Client portal">
        <PortalSwitch client={client} editable={permissions.includes('contacts.manage')} />
      </Section>
      {(permissions.includes('clients.update') || permissions.includes('clients.delete')) && (
        <Section id="remove-heading" title="Archive or delete">
          <ArchiveOrDelete client={client} permissions={permissions} />
        </Section>
      )}
    </div>
  );
}

function BillingForm({ client, editable }: { client: Client; editable: boolean }) {
  const update = useMutation(api.clients.updateBilling);
  const [legalName, setLegalName] = useState(client.legalName ?? '');
  const [address, setAddress] = useState(client.addressLines.join('\n'));
  const [tin, setTin] = useState(client.tin ?? '');
  const [vatTreatment, setVatTreatment] = useState(client.vatTreatment);
  const [whtApplies, setWhtApplies] = useState(client.whtApplies);
  const [whtRate, setWhtRate] = useState(client.whtBps === undefined ? '5' : formatBpsAsPercent(client.whtBps));
  const [currency, setCurrency] = useState<Currency>(client.defaultCurrency);
  const [terms, setTerms] = useState(client.paymentTermsDays === undefined ? '' : String(client.paymentTermsDays));
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  async function save() {
    if (terms.trim() && !/^\d+$/.test(terms.trim())) {
      setState({ kind: 'error', message: 'Payment terms must be a whole number of days' });
      return;
    }
    setState({ kind: 'idle' });
    try {
      await update({
        clientId: client.id,
        legalName: legalName || undefined,
        addressLines: address.split('\n'),
        tin: tin || undefined,
        vatTreatment,
        whtApplies,
        whtBps: whtApplies ? parsePercentToBps(whtRate) : undefined,
        defaultCurrency: currency,
        paymentTermsDays: terms.trim() ? Number(terms) : undefined,
      });
      setState({ kind: 'saved' });
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  }

  return (
    <fieldset disabled={!editable} className="space-y-5">
      <legend className="sr-only">Billing details</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="billing-legal-name">Legal name</Label>
          <Input id="billing-legal-name" value={legalName} onChange={(event) => setLegalName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="billing-tin">TIN</Label>
          <Input id="billing-tin" value={tin} onChange={(event) => setTin(event.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="billing-address">Address</Label>
        <Textarea id="billing-address" rows={3} value={address} onChange={(event) => setAddress(event.target.value)} />
        <p className="text-sm text-muted-foreground">One line per row, up to 6.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="billing-vat">VAT treatment</Label>
          <NativeSelect
            id="billing-vat"
            value={vatTreatment}
            onChange={(event) => setVatTreatment(event.target.value as Client['vatTreatment'])}
          >
            {Object.entries(VAT_TREATMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="billing-currency">Currency</Label>
          <NativeSelect
            id="billing-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            <option value="NGN">NGN</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="billing-terms">Payment terms (days)</Label>
          <Input
            id="billing-terms"
            inputMode="numeric"
            value={terms}
            placeholder="Studio default"
            onChange={(event) => setTerms(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex items-center gap-2 sm:h-9">
          <Checkbox
            id="billing-wht"
            checked={whtApplies}
            onCheckedChange={(checked) => setWhtApplies(checked === true)}
          />
          <Label htmlFor="billing-wht" className="font-normal">
            The client deducts withholding tax
          </Label>
        </div>
        {whtApplies && (
          <div className="space-y-2 sm:w-32">
            <Label htmlFor="billing-wht-rate">WHT rate (%)</Label>
            <Input
              id="billing-wht-rate"
              inputMode="decimal"
              value={whtRate}
              onChange={(event) => setWhtRate(event.target.value)}
            />
          </div>
        )}
      </div>
      {editable ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" onClick={() => void save()}>
            Save billing details
          </Button>
          <SaveStatus state={state} />
        </div>
      ) : (
        <p className="rounded-md border p-4 text-sm">Only the Owner, Admins and Finance can change billing details.</p>
      )}
    </fieldset>
  );
}

function SlaPolicy({ client, editable }: { client: Client; editable: boolean }) {
  const policies = useQuery(api.clients.slaPolicyOptions, {});
  const setPolicy = useMutation(api.clients.setSlaPolicy);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  return (
    <div className="space-y-2 sm:w-72">
      <Label htmlFor="client-sla">SLA policy</Label>
      <NativeSelect
        id="client-sla"
        value={client.slaPolicyId ?? ''}
        disabled={!editable || !policies}
        onChange={async (event) => {
          setState({ kind: 'idle' });
          try {
            await setPolicy({
              clientId: client.id,
              slaPolicyId: (event.target.value || undefined) as Id<'slaPolicies'> | undefined,
            });
            setState({ kind: 'saved' });
          } catch (error) {
            setState({ kind: 'error', message: errorMessage(error) });
          }
        }}
      >
        <option value="">None</option>
        {policies?.map((policy) => (
          <option key={policy.id} value={policy.id}>
            {policy.name}
          </option>
        ))}
      </NativeSelect>
      <SaveStatus state={state} />
    </div>
  );
}

function PortalSwitch({ client, editable }: { client: Client; editable: boolean }) {
  const setEnabled = useMutation(api.clients.setPortalEnabled);
  const [error, setError] = useState<string | null>(null);
  const label = client.portalEnabled ? 'The portal is on' : 'The portal is off';

  const control = (
    <Switch
      id="client-portal"
      checked={client.portalEnabled}
      disabled={!editable}
      aria-describedby="client-portal-help"
    />
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {client.portalEnabled && editable ? (
          <ConfirmDialog
            trigger={control}
            title={`Turn off the portal for ${client.displayName}?`}
            description="Every contact is signed out at once and cannot sign in until it is turned on again."
            confirmLabel="Turn off"
            onConfirm={() => setEnabled({ clientId: client.id, enabled: false })}
          />
        ) : (
          <Switch
            id="client-portal"
            checked={client.portalEnabled}
            disabled={!editable}
            aria-describedby="client-portal-help"
            onCheckedChange={async (checked) => {
              setError(null);
              try {
                await setEnabled({ clientId: client.id, enabled: checked });
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          />
        )}
        <Label htmlFor="client-portal" className="font-normal">
          {label}
        </Label>
      </div>
      <p id="client-portal-help" className="text-sm text-muted-foreground">
        Contacts with portal access sign in to follow projects, sign documents and pay invoices. Give access to each
        contact on the Contacts tab.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ArchiveOrDelete({ client, permissions }: { client: Client; permissions: string[] }) {
  const router = useRouter();
  const setStatus = useMutation(api.clients.setStatus);
  const remove = useMutation(api.clients.remove);
  const archived = client.status === 'archived';

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        Archiving hides the client from the list and keeps everything. Deleting is only for a client created by mistake,
        with no deals and no contact who has used the portal.
      </p>
      <div className="flex flex-wrap gap-2">
        {permissions.includes('clients.update') &&
          (archived ? (
            <Button
              variant="outline"
              onClick={() =>
                void setStatus({ clientId: client.id, status: 'past', reason: 'Restored from the archive' })
              }
            >
              Restore from archive
            </Button>
          ) : (
            <ConfirmDialog
              trigger={<Button variant="outline">Archive client</Button>}
              title={`Archive ${client.displayName}?`}
              description="It is hidden from the client list and kept with all its history."
              confirmLabel="Archive"
              onConfirm={() => setStatus({ clientId: client.id, status: 'archived' })}
            />
          ))}
        {permissions.includes('clients.delete') && (
          <ConfirmDialog
            trigger={<Button variant="destructive">Delete client</Button>}
            title={`Delete ${client.displayName}?`}
            description="The client, its contacts and its timeline are deleted for good."
            confirmLabel="Delete"
            onConfirm={async () => {
              await remove({ clientId: client.id });
              router.push('/crm/clients');
            }}
          />
        )}
      </div>
    </div>
  );
}
