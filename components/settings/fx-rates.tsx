'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { MICRO_PER_UNIT } from '@/convex/lib/money';
import { errorMessage, InputError } from '@/lib/convex-error';
import { formatDay } from '@/lib/crm-display';
import { lagosToday } from '@/lib/invoices-display';

// Exchange rates (08-billing-and-finance.md, Foreign exchange): naira per dollar and per euro, entered by hand, one per
// day. A USD or EUR invoice is sent only with a rate from the last 7 days, and keeps the rate it was sent with.

type FxCurrency = 'USD' | 'EUR';

const naira = (micro: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 6 }).format(
    micro / MICRO_PER_UNIT,
  );

function parseRate(input: string): number {
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(input.trim().replace(/[,\s]/g, ''));
  if (!match) throw new InputError(`"${input}" is not a rate in naira`);
  return Number(match[1]) * MICRO_PER_UNIT + Number((match[2] ?? '').padEnd(6, '0') || '0');
}

export function FxRates() {
  const current = useQuery(api.fx.current, {});
  const [currency, setCurrency] = useState<FxCurrency>('USD');
  const history = useQuery(api.fx.history, { currency });
  const setRate = useMutation(api.fx.setRate);
  const [date, setDate] = useState(lagosToday());
  const [rate, setRateInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2">
        {(current ?? []).map((row) => (
          <div key={row.currency} className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{row.currency}</p>
              <ToneBadge
                label={row.fresh ? 'Up to date' : row.date ? 'Older than 7 days' : 'No rate yet'}
                tone={row.fresh ? 'built' : 'attention'}
              />
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {row.rateToNgnMicro ? naira(row.rateToNgnMicro) : '—'}
            </p>
            <p className="text-sm text-muted-foreground">{row.date ? `Set for ${formatDay(row.date)}` : 'Never set'}</p>
          </div>
        ))}
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        aria-label="Set a rate"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setSaving(true);
          try {
            await setRate({ currency, date, rateToNgnMicro: parseRate(rate) });
            setRateInput('');
          } catch (caught) {
            setError(errorMessage(caught));
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="fx-currency">Currency</Label>
          <NativeSelect
            id="fx-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as FxCurrency)}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="fx-date">For the day</Label>
          <Input
            id="fx-date"
            type="date"
            max={lagosToday()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fx-rate">Naira per {currency}</Label>
          <Input
            id="fx-rate"
            inputMode="decimal"
            placeholder="1550.25"
            value={rate}
            onChange={(event) => setRateInput(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={saving || !rate.trim()}>
          {saving ? 'Saving…' : 'Save the rate'}
        </Button>
        {error && (
          <p role="alert" className="w-full text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      <p className="text-sm text-muted-foreground">Saving a rate for a day that already has one replaces it.</p>

      <section className="space-y-2">
        <h2 className="font-medium">Recent {currency} rates</h2>
        {history && history.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <ul className="divide-y rounded-lg border text-sm">
          {(history ?? []).map((row) => (
            <li key={row.id} className="flex justify-between px-4 py-2">
              <span>{formatDay(row.date)}</span>
              <span className="tabular-nums">{naira(row.rateToNgnMicro)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
