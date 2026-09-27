'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { AssetForm } from '@/components/support/asset-form';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import { ASSET_TYPE_LABEL, type AssetType, renewal } from '@/lib/support-display';

// What Unbuilt keeps alive for this client (09-support-and-sla.md), on the client's own page. Everything is shown,
// including what has been handed over: on a client's page the question is what Unbuilt holds, not only what is due.

export function ClientAssets({ clientId }: { clientId: Id<'clients'> }) {
  const assets = useQuery(api.assets.list, { clientId, status: 'all' });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AssetForm
          clientId={clientId}
          trigger={
            <Button>
              <Plus aria-hidden />
              Add something to renew
            </Button>
          }
        />
      </div>
      {assets === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          Nothing yet. Add the domains, hosting and subscriptions Unbuilt keeps alive for this client.
        </p>
      ) : (
        <ul className="space-y-3">
          {assets.map((asset) => (
            <li key={asset.id} className="rounded-lg border p-4">
              <Link href={`/support/assets/${asset.id}`} className="block">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{asset.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {ASSET_TYPE_LABEL[asset.type as AssetType]} · {asset.provider} · {formatDay(asset.renewsOnDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    {asset.billPriceMinor !== undefined && (
                      <p className="font-medium tabular-nums">
                        {formatMoney(asset.billPriceMinor, asset.billCurrency as Currency)}
                      </p>
                    )}
                    <ToneBadge {...renewal(asset.daysUntilRenewal, asset.status)} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
