'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AssetForm } from '@/components/support/asset-form';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import { ASSET_TYPE_LABEL, type AssetType, renewal } from '@/lib/support-display';

// What the studio keeps alive for its clients (09-support-and-sla.md). Soonest first, because the only question this
// page answers is what is about to lapse.

export function AssetList() {
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const assets = useQuery(api.assets.list, { status });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="asset-filter" className="text-xs text-muted-foreground">
            Show
          </Label>
          <NativeSelect
            id="asset-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="active">Still ours to renew</option>
            <option value="all">Everything</option>
          </NativeSelect>
        </div>
        <div className="sm:ml-auto">
          <AssetForm
            trigger={
              <Button>
                <Plus aria-hidden />
                Add something to renew
              </Button>
            }
          />
        </div>
      </div>

      {assets === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          Nothing here. Add the domains, hosting and subscriptions Unbuilt keeps alive, and it will say when they are
          due.
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
                      {asset.clientName} · {ASSET_TYPE_LABEL[asset.type as AssetType]} · {asset.provider}
                    </p>
                    <p className="text-sm text-muted-foreground">{formatDay(asset.renewsOnDate)}</p>
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
