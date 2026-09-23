'use client';

import { useQuery } from 'convex/react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { toAmountInput } from '@/lib/crm-display';
import { formatQuantity, parseQuantity } from '@/lib/documents-display';

// The priced lines of a quote, proposal, SOW or change request. Amounts are worked out by the server; the running total
// here is only so the person can see what they are building.

export type LineDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxable: boolean;
  rateCardItemId?: Id<'rateCardItems'>;
};

export const emptyLine = (): LineDraft => ({ description: '', quantity: '1', unitPrice: '', taxable: true });

export const toLineArgs = (lines: LineDraft[], currency: Currency) =>
  lines
    .filter((line) => line.description.trim() || line.unitPrice.trim())
    .map((line) => ({
      description: line.description,
      quantityMilli: parseQuantity(line.quantity),
      unitPriceMinor: parseMoneyInput(line.unitPrice || '0', currency),
      taxable: line.taxable,
      rateCardItemId: line.rateCardItemId,
    }));

export const toLineDrafts = (
  lineItems: { description: string; quantityMilli: number; unitPriceMinor: number; taxable: boolean }[] | undefined,
): LineDraft[] =>
  (lineItems ?? []).map((item) => ({
    description: item.description,
    quantity: formatQuantity(item.quantityMilli),
    unitPrice: toAmountInput(item.unitPriceMinor),
    taxable: item.taxable,
  }));

/** The running total, ignoring anything not yet a number so typing never shows an error. */
function runningTotal(lines: LineDraft[]): number {
  return lines.reduce((sum, line) => {
    const quantity = Number(line.quantity.replace(',', '.'));
    const price = Number(line.unitPrice.replace(/[,\s]/g, ''));
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return sum;
    return sum + Math.round(quantity * price * 100);
  }, 0);
}

export function LineItemsEditor({
  lines,
  onChange,
  currency,
  canUseRateCard,
  idPrefix,
  showVat = true,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  currency: Currency;
  /** ratecard.view: pick an item and its price instead of typing one. */
  canUseRateCard: boolean;
  idPrefix: string;
  /** False when nothing here charges VAT, so the per-line boxes would do nothing. */
  showVat?: boolean;
}) {
  const rateCard = useQuery(api.rateCard.list, canUseRateCard ? {} : 'skip');
  const set = (index: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((line, at) => (at === index ? { ...line, ...patch } : line)));

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <Label>The work and its price</Label>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatMoney(runningTotal(lines), currency)} before tax
        </span>
      </div>

      {lines.length === 0 && <p className="text-sm text-muted-foreground">No lines yet.</p>}

      <ul className="space-y-3">
        {lines.map((line, index) => (
          <li key={index} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap gap-2">
              {rateCard && rateCard.length > 0 && (
                <div className="w-full sm:w-52">
                  <Label htmlFor={`${idPrefix}-item-${index}`} className="sr-only">
                    Rate card item for line {index + 1}
                  </Label>
                  <NativeSelect
                    id={`${idPrefix}-item-${index}`}
                    value={line.rateCardItemId ?? ''}
                    onChange={(event) => {
                      const item = rateCard.find((candidate) => candidate.id === event.target.value);
                      // An item priced in this currency fills the price in; one that is not leaves it to be typed.
                      const priced = item?.prices.find((price) => price.currency === currency);
                      set(index, {
                        rateCardItemId: (event.target.value || undefined) as Id<'rateCardItems'> | undefined,
                        description: item ? item.name : line.description,
                        unitPrice: priced ? toAmountInput(priced.unitPriceMinor) : line.unitPrice,
                        taxable: item ? item.taxable : line.taxable,
                      });
                    }}
                  >
                    <option value="">From the rate card…</option>
                    {rateCard.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <Label htmlFor={`${idPrefix}-description-${index}`} className="sr-only">
                  Line {index + 1} description
                </Label>
                <Input
                  id={`${idPrefix}-description-${index}`}
                  placeholder="What it is"
                  value={line.description}
                  onChange={(event) => set(index, { description: event.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${index + 1}`}
                onClick={() => onChange(lines.filter((_, at) => at !== index))}
              >
                <X aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-24">
                <Label htmlFor={`${idPrefix}-quantity-${index}`} className="text-xs text-muted-foreground">
                  Quantity
                </Label>
                <Input
                  id={`${idPrefix}-quantity-${index}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => set(index, { quantity: event.target.value })}
                />
              </div>
              <div className="w-36">
                <Label htmlFor={`${idPrefix}-price-${index}`} className="text-xs text-muted-foreground">
                  Unit price ({currency})
                </Label>
                <Input
                  id={`${idPrefix}-price-${index}`}
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(event) => set(index, { unitPrice: event.target.value })}
                />
              </div>
              <div className={`flex items-center gap-2 pt-4 ${showVat ? '' : 'hidden'}`}>
                <Checkbox
                  id={`${idPrefix}-taxable-${index}`}
                  checked={line.taxable}
                  onCheckedChange={(checked) => set(index, { taxable: checked === true })}
                />
                <Label htmlFor={`${idPrefix}-taxable-${index}`} className="font-normal">
                  VAT on this line
                </Label>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine()])}>
        <Plus aria-hidden />
        Add a line
      </Button>
    </div>
  );
}
