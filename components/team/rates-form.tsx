'use client';

import { useMutation } from 'convex/react';
import { useState } from 'react';
import { SaveStatus } from '@/components/settings/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, parseMoneyInput } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';

const CURRENCIES: Currency[] = ['NGN', 'USD', 'EUR'];

const toInput = (minor: number | undefined) =>
  minor === undefined ? '' : (minor / 100).toFixed(2).replace(/\.00$/, '');

/** Hourly cost and bill rates. Only rendered for roles with team.rates.sensitive; the query omits rates otherwise. */
export function RatesForm({
  memberId,
  rates,
}: {
  memberId: Id<'teamMembers'>;
  rates: { costRateMinor?: number; billRateMinor?: number; currency?: Currency };
}) {
  const setRates = useMutation(api.team.setRates);
  const [currency, setCurrency] = useState<Currency>(rates.currency ?? 'NGN');
  const [cost, setCost] = useState(toInput(rates.costRateMinor));
  const [bill, setBill] = useState(toInput(rates.billRateMinor));
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });

  async function save() {
    setStatus({ kind: 'idle' });
    try {
      const parse = (value: string) => (value.trim() === '' ? undefined : parseMoneyInput(value, currency));
      await setRates({ memberId, currency, costRateMinor: parse(cost), billRateMinor: parse(bill) });
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error, 'Enter amounts such as 15000 or 15,000.50') });
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        Per hour. New rates apply to time logged from now on; time already logged keeps its rate.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="rates-currency">Currency</Label>
          <NativeSelect
            id="rates-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            {CURRENCIES.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="rates-cost">Cost rate</Label>
          <Input id="rates-cost" inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rates-bill">Bill rate</Label>
          <Input id="rates-bill" inputMode="decimal" value={bill} onChange={(event) => setBill(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button variant="outline" onClick={() => void save()}>
          Save rates
        </Button>
        <SaveStatus state={status} />
      </div>
    </div>
  );
}
