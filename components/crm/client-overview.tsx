'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { MentionText, Timeline } from '@/components/crm/timeline';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { CLIENT_STATUSES, type ClientStatus, clientStatus } from '@/lib/crm-display';

function Figure({ label, value, note }: { label: string; value?: string; note?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      {value !== undefined ? (
        <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      ) : (
        <p className="mt-1 text-sm text-draft">{note}</p>
      )}
    </div>
  );
}

function openDealTotals(deals: { valueMinor: number; currency: Currency }[]) {
  const totals = new Map<Currency, number>();
  for (const deal of deals) totals.set(deal.currency, (totals.get(deal.currency) ?? 0) + deal.valueMinor);
  return [...totals].map(([currency, total]) => formatMoney(total, currency)).join(' + ');
}

export function ClientOverview({ clientId, permissions }: { clientId: Id<'clients'>; permissions: string[] }) {
  const client = useQuery(api.clients.get, { clientId });
  const contacts = useQuery(api.contacts.listForClient, { clientId });
  const canViewDeals = permissions.includes('deals.view');
  const deals = useQuery(api.deals.list, canViewDeals ? { clientId, status: 'open' } : 'skip');

  if (client === undefined) return <p className="text-muted-foreground">Loading…</p>;
  const primary = contacts?.find((contact) => contact.isPrimary);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-8">
        <section aria-labelledby="figures-heading" className="space-y-3">
          <h2 id="figures-heading" className="sr-only">
            Key figures
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {canViewDeals && (
              <Figure
                label={deals && deals.length > 0 ? `Open deals (${deals.length})` : 'Open deals'}
                value={deals === undefined ? '…' : deals.length === 0 ? 'None' : openDealTotals(deals)}
              />
            )}
            <Figure label="Lifetime billed" note="Arrives with billing" />
            <Figure label="Outstanding balance" note="Arrives with billing" />
            <Figure label="Active projects" note="Arrives with projects" />
            <Figure label="Open tickets" note="Arrives with support" />
          </div>
        </section>

        <section aria-labelledby="recent-heading" className="space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="recent-heading" className="font-display text-xl font-bold">
              Recent activity
            </h2>
            <Link href={`/crm/clients/${clientId}/activity`} className="text-sm underline underline-offset-4">
              Full timeline
            </Link>
          </div>
          <Timeline
            subject={{ table: 'clients', id: clientId }}
            canAdd={false}
            canMention={permissions.includes('team.view')}
            limit={5}
          />
        </section>
      </div>

      <aside className="space-y-6">
        <section aria-labelledby="about-heading" className="space-y-3 rounded-lg border p-4">
          <h2 id="about-heading" className="font-display text-lg font-bold">
            About
          </h2>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Primary contact</dt>
            <dd>{primary ? `${primary.name} (${primary.email})` : 'None yet'}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="break-all">
              {client.website ? (
                <a href={client.website} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {client.website.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-muted-foreground">Country</dt>
            <dd>{client.country ?? '—'}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd>{client.source ?? '—'}</dd>
            <dt className="text-muted-foreground">Tags</dt>
            <dd>{client.tags.join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">Client since</dt>
            <dd>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(client.createdAt)}</dd>
          </dl>
          {client.notes && (
            <div className="border-t pt-3">
              <MentionText body={client.notes} />
            </div>
          )}
        </section>

        {permissions.includes('clients.update') && (
          <StatusChanger clientId={clientId} status={client.status} name={client.displayName} />
        )}
      </aside>
    </div>
  );
}

function StatusChanger({ clientId, status, name }: { clientId: Id<'clients'>; status: ClientStatus; name: string }) {
  const setStatus = useMutation(api.clients.setStatus);
  const [next, setNext] = useState<ClientStatus>(status);
  const [reason, setReason] = useState('');

  return (
    <section aria-labelledby="status-heading" className="space-y-3 rounded-lg border p-4">
      <h2 id="status-heading" className="font-display text-lg font-bold">
        Status
      </h2>
      <p className="text-sm text-muted-foreground">
        Lead becomes active when the first project starts, and past when the last one ends. Change it here when that
        does not fit.
      </p>
      <div className="space-y-2">
        <Label htmlFor="client-status">Status</Label>
        <NativeSelect id="client-status" value={next} onChange={(event) => setNext(event.target.value as ClientStatus)}>
          {CLIENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {clientStatus(value).label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ConfirmDialog
        trigger={
          <Button variant="outline" disabled={next === status}>
            Change status
          </Button>
        }
        title={`Mark ${name} as ${clientStatus(next).label.toLowerCase()}?`}
        description="The change and your reason go on the timeline."
        confirmLabel="Change status"
        onConfirm={async () => {
          await setStatus({ clientId, status: next, reason: reason || undefined });
          setReason('');
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="client-status-reason">Reason (optional)</Label>
          <Textarea id="client-status-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
      </ConfirmDialog>
    </section>
  );
}
