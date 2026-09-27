'use client';

import { useQuery } from 'convex/react';
import { KeyRound, Plus } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VaultItemForm } from '@/components/vault/vault-item-form';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatMoment } from '@/lib/support-display';
import { rotationDue, VAULT_KIND_LABEL, VAULT_STATUS_LABEL, type VaultKind } from '@/lib/vault-display';

// The vault as a list (10-vault.md, Access). Metadata only: no query returns a secret, so there is nothing here to
// hide. The same list serves the whole vault, one client and one project; what differs is only what was asked for.

function today(): string {
  // Africa/Lagos, matching the reminders, so "today" on screen and "today" in a reminder are the same day.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

export function VaultList({
  clientId,
  projectId,
  canManage,
  canSeeAll,
  showClient = false,
}: {
  clientId?: Id<'clients'>;
  projectId?: Id<'projects'>;
  canManage: boolean;
  canSeeAll: boolean;
  showClient?: boolean;
}) {
  const items = useQuery(api.vaultData.list, { clientId, projectId });
  const now = today();

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <VaultItemForm
            clientId={clientId}
            projectId={projectId}
            canSeeAll={canSeeAll}
            trigger={
              <Button>
                <Plus aria-hidden />
                Add a credential
              </Button>
            }
          />
        </div>
      )}
      {items === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          Nothing here. Credentials kept in the vault are encrypted, and every time one is read it is recorded.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const due = rotationDue(item.rotateByDate, now);
            return (
              <li key={item.id} className="rounded-lg border p-4">
                <Link href={`/vault/${item.id}`} className="block">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        <KeyRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{item.label}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {VAULT_KIND_LABEL[item.kind as VaultKind]}
                        {showClient && ` · ${item.clientName}`}
                        {item.url && ` · ${item.url}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.status !== 'active' && <Badge variant="outline">{VAULT_STATUS_LABEL[item.status]}</Badge>}
                      {due && <Badge variant={due.tone === 'danger' ? 'destructive' : 'secondary'}>{due.label}</Badge>}
                      {item.submittedByKind === 'client' && <Badge variant="outline">From the client</Badge>}
                    </div>
                  </div>
                  {item.lastRevealedAt !== undefined && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Last revealed {formatMoment(item.lastRevealedAt)}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
