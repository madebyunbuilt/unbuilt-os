'use client';

import { type DocumentBlock } from '@/convex/lib/documentBlocks';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { formatQuantity } from '@/lib/documents-display';

// The document as the client will read it. The text is already resolved, so this only lays it out; the PDF draws the
// same blocks (pdf/document.tsx).

type LineItem = {
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  amountMinor: number;
  taxable: boolean;
};

type Totals = {
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  vatMinor: number;
  totalMinor: number;
  whtExpectedMinor: number;
};

export function DocumentBlocks({
  blocks,
  lineItems,
  totals,
  currency,
}: {
  blocks: DocumentBlock[];
  lineItems?: LineItem[];
  totals?: Totals;
  currency: Currency;
}) {
  return (
    <article className="space-y-3 rounded-lg border bg-background p-6">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const level = block.level ?? 1;
            const className =
              level <= 1
                ? 'font-display text-xl font-bold'
                : level === 2
                  ? 'font-display text-lg font-bold'
                  : 'font-medium';
            return (
              <p key={index} className={`${className} mt-4 first:mt-0`}>
                {block.text}
              </p>
            );
          }
          case 'paragraph':
            return (
              <p key={index} className="whitespace-pre-wrap">
                {block.text}
              </p>
            );
          case 'lineItems':
            return <LineItemsTable key={index} items={lineItems ?? []} currency={currency} title={block.title} />;
          case 'totals':
            return totals ? <TotalsTable key={index} totals={totals} currency={currency} /> : null;
          case 'milestones':
          case 'paymentSchedule':
            return (
              <p key={index} className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {block.title ?? (block.kind === 'milestones' ? 'Milestones' : 'Payment schedule')} — filled in on the
                PDF from the project.
              </p>
            );
          case 'signature':
            return (
              <div key={index} className="mt-6 border-t pt-4 text-sm text-muted-foreground">
                Signature: {block.party === 'client' ? 'the client' : 'the studio'}
              </div>
            );
          case 'pageBreak':
            return <hr key={index} className="my-6 border-dashed" />;
          case 'image':
            return (
              <p key={index} className="text-sm text-muted-foreground">
                [{block.alt}]
              </p>
            );
        }
      })}
    </article>
  );
}

function LineItemsTable({ items, currency, title }: { items: LineItem[]; currency: Currency; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="my-4 space-y-2">
      {title && <p className="font-medium">{title}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <caption className="sr-only">{title ?? 'The work and its price'}</caption>
          <thead className="bg-muted text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Description
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Unit
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-t">
                <td className="px-3 py-2">
                  {item.description}
                  {!item.taxable && <span className="text-muted-foreground"> · no VAT</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(item.quantityMilli)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item.unitPriceMinor, currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item.amountMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TotalsTable({ totals, currency }: { totals: Totals; currency: Currency }) {
  const rows: [string, number][] = [
    ['Subtotal', totals.subtotalMinor],
    ...(totals.discountMinor > 0 ? ([['Discount', -totals.discountMinor]] as [string, number][]) : []),
    ...(totals.vatMinor > 0 ? ([['VAT', totals.vatMinor]] as [string, number][]) : []),
  ];
  return (
    <dl className="my-4 ml-auto w-full max-w-xs space-y-1 text-sm">
      {rows.map(([label, amount]) => (
        <div key={label} className="flex justify-between">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tabular-nums">{formatMoney(amount, currency)}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t pt-1 font-medium">
        <dt>Total</dt>
        <dd className="tabular-nums">{formatMoney(totals.totalMinor, currency)}</dd>
      </div>
      {totals.whtExpectedMinor > 0 && (
        <div className="flex justify-between text-muted-foreground">
          <dt>Withholding tax to deduct</dt>
          <dd className="tabular-nums">{formatMoney(totals.whtExpectedMinor, currency)}</dd>
        </div>
      )}
    </dl>
  );
}
