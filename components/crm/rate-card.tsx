'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { RATE_UNIT_LABELS } from '@/lib/crm-display';

type Item = (typeof api.rateCard.list._returnType)[number];
type Unit = keyof typeof RATE_UNIT_LABELS;

const CURRENCIES: Currency[] = ['NGN', 'USD', 'EUR'];

const toInput = (minor: number | undefined) =>
  minor === undefined ? '' : (minor / 100).toFixed(2).replace(/\.00$/, '');

/** Services and their prices. Items are retired rather than deleted so documents that used them keep their meaning. */
export function RateCard({ canManage }: { canManage: boolean }) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const items = useQuery(api.rateCard.list, { includeInactive });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch id="rate-card-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
          <Label htmlFor="rate-card-inactive" className="font-normal">
            Show retired items
          </Label>
        </div>
        {canManage && (
          <div className="sm:ml-auto">
            <ItemDialog
              trigger={
                <Button>
                  <Plus aria-hidden />
                  Add item
                </Button>
              }
            />
          </div>
        )}
      </div>

      {items === undefined ? (
        <p className="text-muted-foreground">Loading the rate card…</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">No items yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Rate card</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Item
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Unit
                </th>
                {CURRENCIES.map((currency) => (
                  <th key={currency} scope="col" className="px-4 py-2.5 text-right font-medium">
                    {currency}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ItemRow key={item.id} item={item} canManage={canManage} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Prices are never converted. An item without a price in a document’s currency needs one entered on that document.
      </p>
    </div>
  );
}

function ItemRow({ item, canManage }: { item: Item; canManage: boolean }) {
  const setActive = useMutation(api.rateCard.setActive);
  return (
    <tr className="border-t align-top">
      <td className="px-4 py-3">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.name}</span>
          {!item.active && <ToneBadge label="Retired" tone="muted" />}
          {!item.taxable && <ToneBadge label="No VAT" tone="muted" />}
        </span>
        <span className="block text-muted-foreground">
          {[item.category, item.description].filter(Boolean).join(' · ')}
        </span>
      </td>
      <td className="px-4 py-3">{RATE_UNIT_LABELS[item.unit]}</td>
      {CURRENCIES.map((currency) => {
        const price = item.prices.find((entry) => entry.currency === currency);
        return (
          <td key={currency} className="px-4 py-3 text-right tabular-nums">
            {price ? formatMoney(price.unitPriceMinor, currency) : <span className="text-muted-foreground">—</span>}
          </td>
        );
      })}
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {canManage && (
          <>
            <ItemDialog
              item={item}
              trigger={
                <Button variant="ghost" size="sm" aria-label={`Edit ${item.name}`}>
                  Edit
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${item.active ? 'Retire' : 'Bring back'} ${item.name}`}
              onClick={() => void setActive({ itemId: item.id, active: !item.active })}
            >
              {item.active ? 'Retire' : 'Bring back'}
            </Button>
          </>
        )}
      </td>
    </tr>
  );
}

function ItemDialog({ item, trigger }: { item?: Item; trigger: ReactNode }) {
  const create = useMutation(api.rateCard.create);
  const update = useMutation(api.rateCard.update);
  const [open, setOpen] = useState(false);
  const blank = () => ({
    name: item?.name ?? '',
    description: item?.description ?? '',
    category: item?.category ?? '',
    unit: (item?.unit ?? 'day') as Unit,
    taxable: item?.taxable ?? true,
    prices: Object.fromEntries(
      CURRENCIES.map((currency) => [
        currency,
        toInput(item?.prices.find((p) => p.currency === currency)?.unitPriceMinor),
      ]),
    ) as Record<Currency, string>,
  });
  const [values, setValues] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = item ? `rate-item-${item.id}` : 'rate-item-new';

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const prices = CURRENCIES.filter((currency) => values.prices[currency].trim()).map((currency) => ({
        currency,
        unitPriceMinor: parseMoneyInput(values.prices[currency], currency),
      }));
      const args = {
        name: values.name,
        description: values.description || undefined,
        category: values.category || undefined,
        unit: values.unit,
        taxable: values.taxable,
        prices,
      };
      if (item) await update({ itemId: item.id, ...args });
      else await create(args);
      setOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValues(blank());
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{item ? `Edit ${item.name}` : 'Add a rate card item'}</DialogTitle>
          <DialogDescription>
            {item
              ? 'New prices apply to documents created from now on.'
              : 'Leave a currency empty if you do not price it.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-name`}>Name</Label>
              <Input
                id={`${formId}-name`}
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-unit`}>Unit</Label>
              <NativeSelect
                id={`${formId}-unit`}
                value={values.unit}
                onChange={(e) => setValues({ ...values, unit: e.target.value as Unit })}
              >
                {Object.entries(RATE_UNIT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-category`}>Category (optional)</Label>
            <Input
              id={`${formId}-category`}
              value={values.category}
              onChange={(e) => setValues({ ...values, category: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-description`}>Description (optional)</Label>
            <Textarea
              id={`${formId}-description`}
              rows={2}
              value={values.description}
              onChange={(e) => setValues({ ...values, description: e.target.value })}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Prices</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {CURRENCIES.map((currency) => (
                <div key={currency} className="space-y-1">
                  <Label htmlFor={`${formId}-price-${currency}`} className="text-xs text-muted-foreground">
                    {currency}
                  </Label>
                  <Input
                    id={`${formId}-price-${currency}`}
                    inputMode="decimal"
                    value={values.prices[currency]}
                    onChange={(e) => setValues({ ...values, prices: { ...values.prices, [currency]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${formId}-taxable`}
              checked={values.taxable}
              onCheckedChange={(checked) => setValues({ ...values, taxable: checked === true })}
            />
            <Label htmlFor={`${formId}-taxable`} className="font-normal">
              VAT applies
            </Label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={saving || !values.name.trim()}>
            {saving ? 'Saving…' : item ? 'Save item' : 'Add item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
