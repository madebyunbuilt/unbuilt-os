'use client';

import { useQuery } from 'convex/react';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { ClientFormDialog } from '@/components/crm/client-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { CLIENT_STATUSES, type ClientStatus, clientStatus } from '@/lib/crm-display';

export function ClientList({ canCreate, canViewTeam }: { canCreate: boolean; canViewTeam: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatus | ''>('');
  const [tag, setTag] = useState('');
  const [industry, setIndustry] = useState('');
  const deferredSearch = useDeferredValue(search);
  const clients = useQuery(api.clients.list, {
    search: deferredSearch || undefined,
    status: status || undefined,
    tag: tag || undefined,
    industry: industry || undefined,
  });
  const facets = useQuery(api.clients.facets, {});
  const filtering = !!(search || status || tag || industry);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="relative lg:w-72">
          <Label htmlFor="client-search" className="sr-only">
            Search clients
          </Label>
          <Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="client-search"
            type="search"
            placeholder="Search by name or legal name"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex">
          <div className="space-y-1">
            <Label htmlFor="client-status-filter" className="text-xs text-muted-foreground">
              Status
            </Label>
            <NativeSelect
              id="client-status-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value as ClientStatus | '')}
            >
              <option value="">All but archived</option>
              {CLIENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {clientStatus(value).label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="client-tag-filter" className="text-xs text-muted-foreground">
              Tag
            </Label>
            <NativeSelect id="client-tag-filter" value={tag} onChange={(event) => setTag(event.target.value)}>
              <option value="">Any tag</option>
              {facets?.tags.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="client-industry-filter" className="text-xs text-muted-foreground">
              Industry
            </Label>
            <NativeSelect
              id="client-industry-filter"
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
            >
              <option value="">Any industry</option>
              {facets?.industries.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {canCreate && (
          <div className="lg:ml-auto">
            <ClientFormDialog
              canPickOwner={canViewTeam}
              onSaved={(clientId) => router.push(`/crm/clients/${clientId}`)}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  New client
                </Button>
              }
            />
          </div>
        )}
      </div>

      {clients === undefined ? (
        <p className="text-muted-foreground">Loading clients…</p>
      ) : clients.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          {filtering ? 'No clients match these filters.' : 'No clients yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Clients</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Client
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Primary contact
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Owner
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Tags
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id} className="border-t hover:bg-accent/50">
                  <td className="px-4 py-3">
                    <Link href={`/crm/clients/${client.id}`} className="block rounded-md">
                      <span className="block font-medium">{client.displayName}</span>
                      <span className="block text-muted-foreground">
                        {[client.legalName, client.industry].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <ToneBadge {...clientStatus(client.status)} />
                  </td>
                  <td className="px-4 py-3">
                    {client.primaryContact ? (
                      <>
                        <span className="block">{client.primaryContact.name}</span>
                        <span className="block text-muted-foreground">{client.primaryContact.email}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">None yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{client.ownerName ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{client.tags.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
