'use client';

import { useQuery } from 'convex/react';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClientFormDialog } from '@/components/crm/client-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { clientStatus } from '@/lib/crm-display';
import { cn } from '@/lib/utils';

type Tab = { label: string; segment: string; built: boolean; anyOf?: string[] };

// Client page tabs (05-crm.md, Clients). Tabs for modules not built yet stay visible but inert, like the main menu.
export const CLIENT_TABS: Tab[] = [
  { label: 'Overview', segment: '', built: true },
  { label: 'Contacts', segment: 'contacts', built: true },
  { label: 'Deals', segment: 'deals', built: true, anyOf: ['deals.view'] },
  { label: 'Projects', segment: 'projects', built: true, anyOf: ['projects.view.all', 'projects.view.assigned'] },
  {
    label: 'Documents',
    segment: 'documents',
    built: true,
    anyOf: ['documents.view', 'documents.view.assigned'],
  },
  { label: 'Invoices and payments', segment: 'invoices', built: true, anyOf: ['invoices.view'] },
  { label: 'Tickets', segment: 'tickets', built: true, anyOf: ['tickets.view.all', 'tickets.view.assigned'] },
  { label: 'Vault', segment: 'vault', built: true, anyOf: ['vault.view.all', 'vault.view.assigned'] },
  { label: 'Assets', segment: 'assets', built: true, anyOf: ['assets.manage'] },
  { label: 'Activity', segment: 'activity', built: true },
  { label: 'Settings', segment: 'settings', built: true },
];

export function ClientHeader({ clientId, permissions }: { clientId: Id<'clients'>; permissions: string[] }) {
  const client = useQuery(api.clients.get, { clientId });
  const pathname = usePathname();
  const base = `/crm/clients/${clientId}`;
  const tabs = CLIENT_TABS.filter((tab) => !tab.anyOf || tab.anyOf.some((key) => permissions.includes(key)));

  return (
    <div className="space-y-6">
      <Link
        href="/crm/clients"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Clients
      </Link>

      {client === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold">{client.displayName}</h1>
              <ToneBadge {...clientStatus(client.status)} />
            </div>
            <p className="mt-1 text-muted-foreground">
              {[
                client.legalName,
                client.kind === 'individual' ? 'Individual' : client.industry,
                client.ownerName && `Owner: ${client.ownerName}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {permissions.includes('clients.update') && (
            <div className="sm:ml-auto">
              <ClientFormDialog
                client={client}
                canPickOwner={permissions.includes('team.view')}
                trigger={
                  <Button variant="outline">
                    <Pencil aria-hidden />
                    Edit
                  </Button>
                }
              />
            </div>
          )}
        </header>
      )}

      <nav aria-label="Client sections" className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-1">
          {tabs.map((tab) => {
            const href = tab.segment ? `${base}/${tab.segment}` : base;
            const itemClass = 'block border-b-2 px-3 py-2 text-sm whitespace-nowrap';
            if (!tab.built) {
              return (
                <li key={tab.label}>
                  <span
                    aria-disabled="true"
                    title="Not built yet"
                    className={cn(itemClass, 'cursor-not-allowed border-transparent text-draft')}
                  >
                    {tab.label}
                  </span>
                </li>
              );
            }
            const active = tab.segment ? pathname.startsWith(href) : pathname === base;
            return (
              <li key={tab.label}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    itemClass,
                    'font-medium hover:text-foreground',
                    active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground',
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
