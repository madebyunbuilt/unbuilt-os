'use client';

import { useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import {
  emptyLine,
  type LineDraft,
  LineItemsEditor,
  toLineArgs,
  toLineDrafts,
} from '@/components/documents/line-items-editor';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import {
  type Currency,
  formatBpsAsPercent,
  MICRO_PER_UNIT,
  parseMoneyInput,
  parsePercentToBps,
} from '@/convex/lib/money';
import { errorMessage, InputError } from '@/lib/convex-error';
import { toAmountInput } from '@/lib/crm-display';

// Drafting or editing an invoice (08-billing-and-finance.md, Creating). A new one takes the client's currency, VAT
// treatment, WHT and payment terms; the totals are worked out by the server, so the running figure here is only a
// guide. Nothing here goes to the client until it is sent.

type Invoice = NonNullable<typeof api.invoices.get._returnType>;

/** A rate typed as naira per unit, e.g. "1,550.25", into micro-naira. */
function parseRate(input: string): number {
  const cleaned = input.trim().replace(/[,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(cleaned);
  if (!match) throw new InputError(`"${input}" is not a rate in naira`);
  return Number(match[1]) * MICRO_PER_UNIT + Number((match[2] ?? '').padEnd(6, '0') || '0');
}

const rateInput = (micro: number) => String(micro / MICRO_PER_UNIT);

export function InvoiceFormDialog({
  trigger,
  clientId: fixedClientId,
  invoice,
  canUseRateCard,
  onSaved,
}: {
  trigger: ReactNode;
  clientId?: Id<'clients'>;
  /** Editing a draft; omitted when drafting a new one. */
  invoice?: Invoice;
  canUseRateCard: boolean;
  onSaved?: (invoiceId: Id<'invoices'>) => void;
}) {
  const create = useMutation(api.invoices.create);
  const update = useMutation(api.invoices.update);
  const [open, setOpen] = useState(false);
  const editing = invoice !== undefined;
  const clients = useQuery(api.clients.list, open && !fixedClientId && !editing ? {} : 'skip');
  const fxRates = useQuery(api.fx.current, open ? {} : 'skip');

  const [clientId, setClientId] = useState<string>(invoice?.clientId ?? fixedClientId ?? '');
  const chosenClient = clients?.find((client) => client.id === clientId);
  const [currencyChoice, setCurrencyChoice] = useState<Currency | ''>(invoice?.currency ?? '');
  const currency: Currency = currencyChoice || chosenClient?.defaultCurrency || 'NGN';
  const projects = useQuery(
    api.projects.list,
    open && clientId && !editing ? { clientId: clientId as Id<'clients'>, status: 'all' } : 'skip',
  );
  const [projectId, setProjectId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(
    invoice && invoice.lineItems.length > 0 ? toLineDrafts(invoice.lineItems) : [emptyLine()],
  );
  const [discountKind, setDiscountKind] = useState<'none' | 'percent' | 'fixed'>(invoice?.discount.kind ?? 'none');
  const [discountValue, setDiscountValue] = useState(
    invoice?.discount.kind === 'percent' && invoice.discount.bps !== undefined
      ? formatBpsAsPercent(invoice.discount.bps)
      : invoice?.discount.kind === 'fixed'
        ? toAmountInput(invoice.discount.amountMinor)
        : '',
  );
  // On a new invoice these follow the client until they are touched, so what will be charged is on screen before it
  // is created; the server applies the same defaults when nothing is sent.
  const [taxTouched, setTaxTouched] = useState(editing);
  const [vatApplies, setVatApplies] = useState(invoice?.vat.applies ?? true);
  const [vatRate, setVatRate] = useState(invoice ? formatBpsAsPercent(invoice.vat.bps) : '');
  const [whtApplies, setWhtApplies] = useState(invoice?.wht.applies ?? false);
  const [whtRate, setWhtRate] = useState(invoice ? formatBpsAsPercent(invoice.wht.bps) : '');
  const [terms, setTerms] = useState(invoice ? String(invoice.paymentTermsDays) : '');
  const [rate, setRate] = useState(invoice?.fxRateOverridden ? rateInput(invoice.fxRateToNgnMicro) : '');
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [invoiceTerms, setInvoiceTerms] = useState(invoice?.terms ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const latest = fxRates?.find((row) => row.currency === currency);
  const defaults = useQuery(
    api.invoices.defaultsFor,
    open && clientId && !editing ? { clientId: clientId as Id<'clients'> } : 'skip',
  );
  // What this client is charged, until someone changes the boxes.
  if (!taxTouched && defaults) {
    const vatText = formatBpsAsPercent(defaults.vat.bps);
    const whtText = formatBpsAsPercent(defaults.wht.bps);
    if (defaults.vat.applies !== vatApplies) setVatApplies(defaults.vat.applies);
    if (vatText !== vatRate) setVatRate(vatText);
    if (defaults.wht.applies !== whtApplies) setWhtApplies(defaults.wht.applies);
    if (whtText !== whtRate) setWhtRate(whtText);
  }

  const submit = async () => {
    setError(null);
    if (!clientId) {
      setError('Choose the client');
      return;
    }
    const days = terms.trim() ? Number(terms) : undefined;
    if (days !== undefined && (!Number.isInteger(days) || days > 365)) {
      setError('Payment terms are a whole number of days, up to 365');
      return;
    }
    setSaving(true);
    try {
      const discount =
        discountKind === 'percent'
          ? { kind: 'percent' as const, bps: parsePercentToBps(discountValue) }
          : discountKind === 'fixed'
            ? { kind: 'fixed' as const, amountMinor: parseMoneyInput(discountValue, currency) }
            : { kind: 'none' as const };
      const shared = {
        lineItems: toLineArgs(lines, currency),
        discount,
        paymentTermsDays: days,
        fxRateToNgnMicro: currency !== 'NGN' && rate.trim() ? parseRate(rate) : undefined,
        notes: notes || undefined,
        terms: invoiceTerms || undefined,
      };
      if (editing) {
        await update({
          invoiceId: invoice.id,
          ...shared,
          vat: { applies: vatApplies, bps: parsePercentToBps(vatRate || '0') },
          wht: { applies: whtApplies, bps: parsePercentToBps(whtRate || '0') },
        });
        setOpen(false);
        onSaved?.(invoice.id);
      } else {
        const invoiceId = await create({
          clientId: clientId as Id<'clients'>,
          projectId: (projectId || undefined) as Id<'projects'> | undefined,
          currency,
          ...shared,
          ...(taxTouched
            ? {
                vat: { applies: vatApplies, bps: parsePercentToBps(vatRate || '0') },
                wht: { applies: whtApplies, bps: parsePercentToBps(whtRate || '0') },
              }
            : {}),
        });
        setOpen(false);
        onSaved?.(invoiceId);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {editing ? `Edit ${invoice.number ?? 'the draft'}` : 'New invoice'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changes stay on the draft until it is sent. The server works out the totals.'
              : 'It starts as a draft with the client’s currency, VAT, WHT and payment terms. Nothing goes out until you send it.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="invoice-form"
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {!editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              {!fixedClientId && (
                <div className="space-y-2">
                  <Label htmlFor="invoice-client">Client</Label>
                  <NativeSelect
                    id="invoice-client"
                    value={clientId}
                    onChange={(event) => {
                      setClientId(event.target.value);
                      setProjectId('');
                      setCurrencyChoice('');
                    }}
                  >
                    <option value="">Choose a client</option>
                    {(clients ?? []).map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.displayName}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="invoice-project">Project (optional)</Label>
                <NativeSelect
                  id="invoice-project"
                  value={projectId}
                  disabled={!clientId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">No project</option>
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.code} · {project.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-currency">Currency</Label>
                <NativeSelect
                  id="invoice-currency"
                  value={currency}
                  onChange={(event) => setCurrencyChoice(event.target.value as Currency)}
                >
                  <option value="NGN">NGN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </NativeSelect>
              </div>
            </div>
          )}

          <LineItemsEditor
            lines={lines}
            onChange={setLines}
            currency={currency}
            canUseRateCard={canUseRateCard}
            idPrefix="invoice"
            showVat={vatApplies}
          />
          {vatApplies &&
            lines.some((line) => line.description.trim() || line.unitPrice.trim()) &&
            !lines.some((line) => line.taxable) && (
              <p role="status" className="text-sm text-attention-foreground">
                No line carries VAT, so this invoice charges none. Untick “Charge VAT” if that is right.
              </p>
            )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-discount-kind">Discount</Label>
              <div className="flex gap-2">
                <NativeSelect
                  id="invoice-discount-kind"
                  value={discountKind}
                  onChange={(event) => setDiscountKind(event.target.value as typeof discountKind)}
                >
                  <option value="none">None</option>
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </NativeSelect>
                {discountKind !== 'none' && (
                  <Input
                    aria-label={discountKind === 'percent' ? 'Discount percentage' : `Discount in ${currency}`}
                    value={discountValue}
                    placeholder={discountKind === 'percent' ? '10' : '50000'}
                    onChange={(event) => setDiscountValue(event.target.value)}
                  />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-terms">Payment terms</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="invoice-terms"
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  inputMode="numeric"
                  className="w-28"
                  value={terms}
                  placeholder={editing ? '' : 'Client’s'}
                  aria-describedby="invoice-terms-hint"
                  // Digits only: "6 days" becomes "6", so nothing but a whole number reaches the server.
                  onChange={(event) => setTerms(event.target.value.replace(/\D/g, ''))}
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
              <p id="invoice-terms-hint" className="text-sm text-muted-foreground">
                {editing ? 'Days from the day it is sent to its due date.' : 'Leave empty to use the client’s terms.'}
              </p>
            </div>
          </div>

          {(editing || clientId) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="invoice-vat"
                    checked={vatApplies}
                    onCheckedChange={(value) => {
                      setTaxTouched(true);
                      setVatApplies(value === true);
                    }}
                  />
                  <Label htmlFor="invoice-vat" className="font-normal">
                    Charge VAT
                  </Label>
                </div>
                {vatApplies && (
                  <div className="space-y-1">
                    <Label htmlFor="invoice-vat-rate" className="text-sm">
                      VAT rate
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="invoice-vat-rate"
                        inputMode="decimal"
                        className="w-24"
                        value={vatRate}
                        placeholder="7.5"
                        onChange={(event) => {
                          setTaxTouched(true);
                          setVatRate(event.target.value.replace(/[^\d.]/g, ''));
                        }}
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="invoice-wht"
                    checked={whtApplies}
                    onCheckedChange={(value) => {
                      setTaxTouched(true);
                      setWhtApplies(value === true);
                    }}
                  />
                  <Label htmlFor="invoice-wht" className="font-normal">
                    Client deducts WHT
                  </Label>
                </div>
                {whtApplies && (
                  <div className="space-y-1">
                    <Label htmlFor="invoice-wht-rate" className="text-sm">
                      WHT rate
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="invoice-wht-rate"
                        inputMode="decimal"
                        className="w-24"
                        value={whtRate}
                        placeholder="5"
                        onChange={(event) => {
                          setTaxTouched(true);
                          setWhtRate(event.target.value.replace(/[^\d.]/g, ''));
                        }}
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {currency !== 'NGN' && (
            <div className="space-y-2">
              <Label htmlFor="invoice-rate">Exchange rate: naira per {currency} (optional)</Label>
              <Input
                id="invoice-rate"
                inputMode="decimal"
                value={rate}
                placeholder={latest?.rateToNgnMicro ? rateInput(latest.rateToNgnMicro) : 'No rate entered yet'}
                onChange={(event) => setRate(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                {latest?.rateToNgnMicro
                  ? `Leave it empty to use the latest rate (${rateInput(latest.rateToNgnMicro)}, ${latest.date}) when it is sent.`
                  : `There is no ${currency} rate yet. One from the last 7 days is needed before this can be sent.`}
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-notes">Notes (optional)</Label>
              <Textarea id="invoice-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-terms-text">Terms (optional)</Label>
              <Textarea
                id="invoice-terms-text"
                rows={2}
                value={invoiceTerms}
                onChange={(event) => setInvoiceTerms(event.target.value)}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="invoice-form" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save the draft' : 'Create the draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
