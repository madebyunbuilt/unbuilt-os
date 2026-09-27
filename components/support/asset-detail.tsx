'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { AssetForm } from '@/components/support/asset-form';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { formatDay } from '@/lib/crm-display';
import { ASSET_TYPE_LABEL, type AssetType, renewal } from '@/lib/support-display';

// One managed asset (09-support-and-sla.md). What it is, when it goes, what it costs against what it earns, and the
// two things a person does with it: say it was renewed, or hand it over.

type Asset = NonNullable<typeof api.assets.get._returnType>;

/** Saying it has been renewed. The next date is asked for, because the studio knows the term and the app does not. */
function MarkRenewed({ asset }: { asset: Asset }) {
  const markRenewed = useMutation(api.assets.markRenewed);
  const [next, setNext] = useState(asset.suggestedNextDate);

  return (
    <FormDialog
      trigger={<Button>It has been renewed</Button>}
      title={`${asset.name} has been renewed`}
      description="Reminders start again from the new date, and Unbuilt stops saying this one is late."
      submitLabel="Save the new date"
      canSubmit={next.length === 10 && next > asset.renewsOnDate}
      onSubmit={() => markRenewed({ assetId: asset.id, nextRenewsOnDate: next })}
    >
      <div className="space-y-2">
        <Label htmlFor="asset-next">Next renewal</Label>
        <Input id="asset-next" type="date" value={next} onChange={(event) => setNext(event.target.value)} />
        {/* A year is a guess that suits a domain; hosting and certificates are somebody else's term to know. */}
        <p className="text-xs text-muted-foreground">
          A year on is suggested. Change it if this one runs for a month, two years, or anything else.
        </p>
      </div>
    </FormDialog>
  );
}

export function AssetDetail({ assetId }: { assetId: Id<'managedAssets'> }) {
  const asset = useQuery(api.assets.get, { assetId });
  const close = useMutation(api.assets.close);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (asset === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (asset === null) {
    return (
      <div className="space-y-3">
        <Link href="/support/assets" className="text-sm underline">
          ← Renewals
        </Link>
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">That asset is not here.</p>
      </div>
    );
  }

  const run = async (work: Promise<unknown>) => {
    setError(null);
    try {
      await work;
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/support/assets" className="text-sm underline">
          ← Renewals
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold">{asset.name}</h1>
            <p className="mt-1 text-muted-foreground">
              {asset.clientName} · {ASSET_TYPE_LABEL[asset.type as AssetType]} · {asset.provider}
            </p>
          </div>
          <ToneBadge {...renewal(asset.daysUntilRenewal, asset.status)} />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Renews on</dt>
          <dd className="mt-1 text-lg font-medium">{formatDay(asset.renewsOnDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Costs Unbuilt</dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">
            {formatMoney(asset.costMinor, asset.costCurrency as Currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Client pays</dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">
            {asset.billPriceMinor === undefined
              ? 'Not billed on'
              : formatMoney(asset.billPriceMinor, asset.billCurrency as Currency)}
          </dd>
          {asset.autoInvoice && <dd className="text-xs text-muted-foreground">Invoice drafted 30 days before</dd>}
        </div>
      </dl>

      {asset.renewalInvoiceId && (
        <p className="rounded-md border p-4 text-sm">
          This renewal&rsquo;s invoice is drafted.{' '}
          <Link href={`/billing/invoices/${asset.renewalInvoiceId}`} className="underline">
            Check it and send it
          </Link>
          .
        </p>
      )}

      {asset.status === 'active' && asset.daysUntilRenewal < 0 && (
        <p className="rounded-md border border-attention p-4 text-sm">
          This date has passed and nobody has said it was renewed. Unbuilt is telling the admins daily until somebody
          does.
        </p>
      )}

      {asset.notes && <p className="rounded-lg border p-4 text-sm whitespace-pre-wrap">{asset.notes}</p>}

      {asset.status === 'active' ? (
        <div className="flex flex-wrap gap-2">
          <MarkRenewed asset={asset} />
          <AssetForm asset={asset} trigger={<Button variant="outline">Change</Button>} />
          <ConfirmDialog
            trigger={<Button variant="outline">Hand it to the client</Button>}
            title={`Hand ${asset.name} to ${asset.clientName}`}
            description="Unbuilt stops watching the date and stops reminding anybody. Use this at handover."
            confirmLabel="Hand it over"
            onConfirm={() => run(close({ assetId, status: 'transferred' }))}
          />
          <ConfirmDialog
            trigger={<Button variant="outline">Cancel it</Button>}
            title={`Cancel ${asset.name}`}
            description="For something that is being let go rather than handed over. Reminders stop either way."
            confirmLabel="Cancel it"
            onConfirm={() => run(close({ assetId, status: 'cancelled' }))}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-4">
          <p className="text-sm text-muted-foreground">
            {asset.status === 'transferred'
              ? 'This belongs to the client now. Unbuilt no longer renews it or reminds anybody about it.'
              : 'This was cancelled. Unbuilt no longer renews it or reminds anybody about it.'}
          </p>
          <Button variant="outline" onClick={() => router.push('/support/assets')}>
            Back to renewals
          </Button>
        </div>
      )}
    </div>
  );
}
