'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DealFormDialog } from '@/components/crm/deal-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatMoney } from '@/convex/lib/money';
import { formatDay, stageTone } from '@/lib/crm-display';

type Status = 'open' | 'won' | 'lost' | 'all';

/** A client's deals, with "New deal" for this client. */
export function ClientDeals({ clientId, permissions }: { clientId: Id<'clients'>; permissions: string[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('open');
  const deals = useQuery(api.deals.list, { clientId, status });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="client-deal-status" className="text-xs text-muted-foreground">
            Show
          </Label>
          <NativeSelect
            id="client-deal-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as Status)}
          >
            <option value="open">Open deals</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="all">All deals</option>
          </NativeSelect>
        </div>
        {permissions.includes('deals.manage') && (
          <div className="sm:ml-auto">
            <DealFormDialog
              clientId={clientId}
              canPickOwner={permissions.includes('team.view')}
              onSaved={(dealId) => router.push(`/crm/deals/${dealId}`)}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  New deal
                </Button>
              }
            />
          </div>
        )}
      </div>
      {deals === undefined ? (
        <p className="text-muted-foreground">Loading deals…</p>
      ) : deals.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">No deals here.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {deals.map((deal) => (
            <li key={deal.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <Link href={`/crm/deals/${deal.id}`} className="min-w-0 font-medium underline-offset-4 hover:underline">
                {deal.title}
              </Link>
              {deal.stage && <ToneBadge label={deal.stage.name} tone={stageTone(deal.stage.kind)} />}
              <span className="text-sm text-muted-foreground">
                {deal.ownerName}
                {deal.expectedCloseDate ? ` · closes ${formatDay(deal.expectedCloseDate)}` : ''}
              </span>
              <span className="font-medium tabular-nums sm:ml-auto">{formatMoney(deal.valueMinor, deal.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
