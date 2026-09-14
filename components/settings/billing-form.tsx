'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from 'convex/react';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { FormField, SaveStatus } from '@/components/settings/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { formatBpsAsPercent, parsePercentToBps } from '@/convex/lib/money';
import { DEFAULT_NUMBERING, formatNumber, type NumberedRecord } from '@/convex/lib/numbering';
import { errorMessage } from '@/lib/convex-error';

const CURRENCIES = ['NGN', 'USD', 'EUR'] as const;

export const NUMBERED_RECORD_LABELS: Record<NumberedRecord, string> = {
  invoice: 'Invoices',
  quote: 'Quotes',
  proposal: 'Proposals',
  sow: 'Statements of work',
  contract: 'Contracts',
  sla: 'SLAs',
  changeRequest: 'Change requests',
  creditNote: 'Credit notes',
  receipt: 'Receipts',
  ticket: 'Support tickets',
  project: 'Project codes',
};

const RECORDS = Object.keys(DEFAULT_NUMBERING) as NumberedRecord[];

const percent = z.string().refine((value) => {
  try {
    parsePercentToBps(value);
    return true;
  } catch {
    return false;
  }
}, 'Enter a percentage from 0 to 100, with at most two decimals');

const optionalDays = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || (/^\d+$/.test(value) && Number(value) <= 365),
    'Enter 0 to 365 days, or leave empty',
  );

const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`).max(120);

export const billingSchema = z.object({
  defaultCurrency: z.enum(CURRENCIES),
  vatPercent: percent,
  paymentTermsDays: optionalDays,
  quoteValidityDays: optionalDays,
  lateFeeEnabled: z.boolean(),
  lateFeePercent: percent,
  lateFeeGraceDays: optionalDays,
  invoiceFooter: z.string().max(1000),
  numbering: z.record(
    z.string(),
    z.object({
      prefix: z.string().regex(/^[A-Za-z0-9/_-]{1,20}$/, 'Letters, digits, / _ and -, up to 20'),
      padding: z.string().regex(/^(10|[1-9])$/, '1 to 10'),
    }),
  ),
  bankAccounts: z
    .array(
      z.object({
        label: requiredText('Label'),
        currency: z.enum(CURRENCIES),
        bankName: requiredText('Bank name'),
        accountName: requiredText('Account name'),
        accountNumber: requiredText('Account number'),
        swift: z.string().trim().max(20),
        iban: z.string().trim().max(40),
        sortCode: z.string().trim().max(20),
      }),
    )
    .max(10, 'Use at most 10 bank accounts'),
});

type BillingValues = z.infer<typeof billingSchema>;

const optionalNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));
const optionalString = (value: string) => value.trim() || undefined;

/** Converts the form to updateBilling arguments. Numbering keeps only the formats that differ from the defaults. */
export function toBillingArgs(values: BillingValues) {
  const numbering: Record<string, { prefix: string; padding: number }> = {};
  for (const record of RECORDS) {
    const format = values.numbering[record];
    if (!format) continue;
    const padding = Number(format.padding);
    const defaults = DEFAULT_NUMBERING[record];
    if (format.prefix !== defaults.prefix || padding !== defaults.padding) {
      numbering[record] = { prefix: format.prefix, padding };
    }
  }
  return {
    defaultCurrency: values.defaultCurrency,
    defaultVatBps: parsePercentToBps(values.vatPercent),
    defaultPaymentTermsDays: optionalNumber(values.paymentTermsDays),
    quoteValidityDays: optionalNumber(values.quoteValidityDays),
    lateFeePolicy: {
      enabled: values.lateFeeEnabled,
      monthlyBps: parsePercentToBps(values.lateFeePercent),
      graceDays: optionalNumber(values.lateFeeGraceDays),
    },
    invoiceFooter: optionalString(values.invoiceFooter),
    numbering,
    bankAccounts: values.bankAccounts.map((account) => ({
      label: account.label.trim(),
      currency: account.currency,
      bankName: account.bankName.trim(),
      accountName: account.accountName.trim(),
      accountNumber: account.accountNumber.trim(),
      swift: optionalString(account.swift),
      iban: optionalString(account.iban),
      sortCode: optionalString(account.sortCode),
    })),
  };
}

const emptyAccount = {
  label: '',
  currency: 'NGN' as const,
  bankName: '',
  accountName: '',
  accountNumber: '',
  swift: '',
  iban: '',
  sortCode: '',
};

function NumberPreview({
  control,
  record,
}: {
  control: ReturnType<typeof useForm<BillingValues>>['control'];
  record: NumberedRecord;
}) {
  const format = useWatch({ control, name: `numbering.${record}` });
  let preview = '—';
  try {
    preview = formatNumber(1, { prefix: format?.prefix ?? '', padding: Number(format?.padding) });
  } catch {
    // Shown as a dash until the format is valid.
  }
  return <span className="font-mono text-sm">{preview}</span>;
}

export function BillingForm() {
  const settings = useQuery(api.settings.getBilling);
  const update = useMutation(api.settings.updateBilling);
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });

  const values: BillingValues | undefined = settings && {
    defaultCurrency: settings.defaultCurrency,
    vatPercent: formatBpsAsPercent(settings.defaultVatBps),
    paymentTermsDays: settings.defaultPaymentTermsDays?.toString() ?? '',
    quoteValidityDays: settings.quoteValidityDays?.toString() ?? '',
    lateFeeEnabled: settings.lateFeePolicy.enabled,
    lateFeePercent: formatBpsAsPercent(settings.lateFeePolicy.monthlyBps),
    lateFeeGraceDays: settings.lateFeePolicy.graceDays?.toString() ?? '',
    invoiceFooter: settings.invoiceFooter ?? '',
    numbering: Object.fromEntries(
      RECORDS.map((record) => [
        record,
        { prefix: settings.numbering[record].prefix, padding: String(settings.numbering[record].padding) },
      ]),
    ),
    bankAccounts: settings.bankAccounts.map((account) => ({
      ...account,
      swift: account.swift ?? '',
      iban: account.iban ?? '',
      sortCode: account.sortCode ?? '',
    })),
  };

  const form = useForm<BillingValues>({
    resolver: zodResolver(billingSchema),
    values,
    resetOptions: { keepDirtyValues: true },
  });
  const accounts = useFieldArray({ control: form.control, name: 'bankAccounts' });
  const lateFeeEnabled = useWatch({ control: form.control, name: 'lateFeeEnabled' });
  const { errors, isDirty, isSubmitting } = form.formState;

  if (!settings) return <p className="text-muted-foreground">Loading settings…</p>;

  const onSubmit = form.handleSubmit(async (submitted) => {
    setStatus({ kind: 'idle' });
    try {
      await update(toBillingArgs(submitted));
      form.reset(submitted);
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-10">
      <section aria-labelledby="defaults-heading" className="space-y-5">
        <h2 id="defaults-heading" className="font-display text-lg font-bold">
          Invoice defaults
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="defaultCurrency" label="Default currency" error={errors.defaultCurrency?.message}>
            {(field) => (
              <NativeSelect {...field} {...form.register('defaultCurrency')}>
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="vatPercent" label="VAT (%)" help="7.5 is the standard rate" error={errors.vatPercent?.message}>
            {(field) => <Input {...field} {...form.register('vatPercent')} inputMode="decimal" />}
          </FormField>
          <FormField
            id="paymentTermsDays"
            label="Payment terms (days)"
            help="Days until an invoice is due"
            error={errors.paymentTermsDays?.message}
          >
            {(field) => <Input {...field} {...form.register('paymentTermsDays')} inputMode="numeric" />}
          </FormField>
          <FormField id="quoteValidityDays" label="Quotes valid for (days)" error={errors.quoteValidityDays?.message}>
            {(field) => <Input {...field} {...form.register('quoteValidityDays')} inputMode="numeric" />}
          </FormField>
        </div>
        <FormField
          id="invoiceFooter"
          label="Invoice footer"
          help="Printed at the bottom of every invoice"
          error={errors.invoiceFooter?.message}
        >
          {(field) => <Textarea {...field} {...form.register('invoiceFooter')} rows={3} />}
        </FormField>
      </section>

      <section aria-labelledby="late-fees-heading" className="space-y-5">
        <h2 id="late-fees-heading" className="font-display text-lg font-bold">
          Late fees
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Late fees are separate monthly invoices on the unpaid balance. Leave them off until your accountant confirms
          the rate is appropriate.
        </p>
        <div className="flex items-center gap-3">
          <Controller
            control={form.control}
            name="lateFeeEnabled"
            render={({ field }) => (
              <Switch id="lateFeeEnabled" checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
          <Label htmlFor="lateFeeEnabled">Charge late fees</Label>
        </div>
        {lateFeeEnabled && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <FormField id="lateFeePercent" label="Monthly rate (%)" error={errors.lateFeePercent?.message}>
              {(field) => <Input {...field} {...form.register('lateFeePercent')} inputMode="decimal" />}
            </FormField>
            <FormField
              id="lateFeeGraceDays"
              label="Grace period (days)"
              help="After the due date"
              error={errors.lateFeeGraceDays?.message}
            >
              {(field) => <Input {...field} {...form.register('lateFeeGraceDays')} inputMode="numeric" />}
            </FormField>
          </div>
        )}
      </section>

      <section aria-labelledby="bank-heading" className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="bank-heading" className="font-display text-lg font-bold">
            Bank accounts
          </h2>
          <Button
            type="button"
            variant="outline"
            disabled={accounts.fields.length >= 10}
            onClick={() => accounts.append(emptyAccount)}
          >
            <Plus aria-hidden />
            Add account
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Shown on invoices for bank transfer. Only billing admins see them.
        </p>
        {accounts.fields.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No bank accounts yet.</p>
        )}
        {accounts.fields.map((account, index) => {
          const fieldErrors = errors.bankAccounts?.[index];
          return (
            <fieldset key={account.id} className="relative space-y-4 rounded-lg border p-4">
              <legend className="float-left pt-1.5 font-medium">Account {index + 1}</legend>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute top-3 right-3"
                onClick={() => accounts.remove(index)}
                aria-label={`Remove account ${index + 1}`}
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
              <div className="clear-left grid gap-4 pt-2 sm:grid-cols-2">
                <FormField
                  id={`bank-${index}-label`}
                  label="Label"
                  help="Such as “Naira account”"
                  error={fieldErrors?.label?.message}
                >
                  {(field) => <Input {...field} {...form.register(`bankAccounts.${index}.label`)} />}
                </FormField>
                <FormField id={`bank-${index}-currency`} label="Currency" error={fieldErrors?.currency?.message}>
                  {(field) => (
                    <NativeSelect {...field} {...form.register(`bankAccounts.${index}.currency`)}>
                      {CURRENCIES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField id={`bank-${index}-bankName`} label="Bank name" error={fieldErrors?.bankName?.message}>
                  {(field) => <Input {...field} {...form.register(`bankAccounts.${index}.bankName`)} />}
                </FormField>
                <FormField
                  id={`bank-${index}-accountName`}
                  label="Account name"
                  error={fieldErrors?.accountName?.message}
                >
                  {(field) => <Input {...field} {...form.register(`bankAccounts.${index}.accountName`)} />}
                </FormField>
                <FormField
                  id={`bank-${index}-accountNumber`}
                  label="Account number"
                  error={fieldErrors?.accountNumber?.message}
                >
                  {(field) => (
                    <Input
                      {...field}
                      {...form.register(`bankAccounts.${index}.accountNumber`)}
                      autoComplete="off"
                      inputMode="numeric"
                      className="font-mono"
                    />
                  )}
                </FormField>
                <FormField
                  id={`bank-${index}-sortCode`}
                  label="Sort code (optional)"
                  error={fieldErrors?.sortCode?.message}
                >
                  {(field) => (
                    <Input {...field} {...form.register(`bankAccounts.${index}.sortCode`)} autoComplete="off" />
                  )}
                </FormField>
                <FormField id={`bank-${index}-swift`} label="SWIFT (optional)" error={fieldErrors?.swift?.message}>
                  {(field) => <Input {...field} {...form.register(`bankAccounts.${index}.swift`)} autoComplete="off" />}
                </FormField>
                <FormField id={`bank-${index}-iban`} label="IBAN (optional)" error={fieldErrors?.iban?.message}>
                  {(field) => <Input {...field} {...form.register(`bankAccounts.${index}.iban`)} autoComplete="off" />}
                </FormField>
              </div>
            </fieldset>
          );
        })}
      </section>

      <section aria-labelledby="numbering-heading" className="space-y-5">
        <h2 id="numbering-heading" className="font-display text-lg font-bold">
          Document numbers
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          A new format applies to the next number issued. Existing numbers never change, and counting never restarts.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Record
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Prefix
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Digits
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  First number
                </th>
              </tr>
            </thead>
            <tbody>
              {RECORDS.map((record) => {
                const recordErrors = errors.numbering?.[record];
                return (
                  <tr key={record} className="border-t">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {NUMBERED_RECORD_LABELS[record]}
                    </th>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`${NUMBERED_RECORD_LABELS[record]} prefix`}
                        aria-invalid={recordErrors?.prefix ? true : undefined}
                        className="h-8 font-mono"
                        {...form.register(`numbering.${record}.prefix`)}
                      />
                      {recordErrors?.prefix && <p className="mt-1 text-destructive">{recordErrors.prefix.message}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`${NUMBERED_RECORD_LABELS[record]} digits`}
                        aria-invalid={recordErrors?.padding ? true : undefined}
                        className="h-8 w-20"
                        inputMode="numeric"
                        {...form.register(`numbering.${record}.padding`)}
                      />
                      {recordErrors?.padding && <p className="mt-1 text-destructive">{recordErrors.padding.message}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <NumberPreview control={form.control} record={record} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center">
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
        <SaveStatus state={status} />
      </div>
    </form>
  );
}
