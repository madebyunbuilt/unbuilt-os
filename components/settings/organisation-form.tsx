'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from 'convex/react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField, SaveStatus } from '@/components/settings/form-field';
import { LogoUploader } from '@/components/settings/logo-uploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { errorMessage } from '@/lib/convex-error';

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour such as #11297A');

export const organisationSchema = z.object({
  legalName: z.string().trim().max(200),
  tradingName: z.string().trim().max(200),
  address: z
    .string()
    .refine((value) => value.split('\n').filter((line) => line.trim()).length <= 6, 'Use at most 6 lines'),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Use the two-letter country code, such as NG'),
  tin: z.string().trim().max(40),
  vatNumber: z.string().trim().max(40),
  timezone: z.string().min(1, 'Choose a timezone'),
  retentionYears: z
    .string()
    .regex(/^\d+$/, 'Enter a whole number of years')
    .refine((value) => {
      const years = Number(value);
      return years >= 1 && years <= 50;
    }, 'Between 1 and 50 years'),
  brandPrimary: hexColour,
  brandAccent: hexColour,
});

type OrganisationValues = z.infer<typeof organisationSchema>;

const blankToUndefined = (value: string) => value.trim() || undefined;

export function toOrganisationArgs(values: OrganisationValues) {
  return {
    legalName: blankToUndefined(values.legalName),
    tradingName: blankToUndefined(values.tradingName),
    addressLines: values.address
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    country: values.country.trim().toUpperCase(),
    tin: blankToUndefined(values.tin),
    vatNumber: blankToUndefined(values.vatNumber),
    timezone: values.timezone,
    retentionYears: Number(values.retentionYears),
    brand: { primary: values.brandPrimary, accent: values.brandAccent },
  };
}

export function OrganisationForm() {
  const settings = useQuery(api.settings.getOrganisation);
  const update = useMutation(api.settings.updateOrganisation);
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);

  const values: OrganisationValues | undefined = settings && {
    legalName: settings.legalName ?? '',
    tradingName: settings.tradingName ?? '',
    address: settings.addressLines.join('\n'),
    country: settings.country,
    tin: settings.tin ?? '',
    vatNumber: settings.vatNumber ?? '',
    timezone: settings.timezone,
    retentionYears: String(settings.retentionYears),
    brandPrimary: settings.brand.primary,
    brandAccent: settings.brand.accent,
  };

  const form = useForm<OrganisationValues>({
    resolver: zodResolver(organisationSchema),
    values,
    resetOptions: { keepDirtyValues: true },
  });
  const { errors, isDirty, isSubmitting } = form.formState;

  if (!settings) return <p className="text-muted-foreground">Loading settings…</p>;

  const onSubmit = form.handleSubmit(async (submitted) => {
    setStatus({ kind: 'idle' });
    try {
      await update(toOrganisationArgs(submitted));
      form.reset(submitted);
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    }
  });

  return (
    <div className="space-y-10">
      <section aria-labelledby="logo-heading" className="space-y-4">
        <h2 id="logo-heading" className="font-display text-lg font-bold">
          Logo
        </h2>
        <LogoUploader logoFileId={settings.logoFileId} />
      </section>

      <form onSubmit={onSubmit} noValidate className="space-y-10">
        <section aria-labelledby="identity-heading" className="space-y-5">
          <h2 id="identity-heading" className="font-display text-lg font-bold">
            Company details
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="legalName"
              label="Legal name"
              help="As registered with CAC"
              error={errors.legalName?.message}
            >
              {(field) => <Input {...field} {...form.register('legalName')} autoComplete="organization" />}
            </FormField>
            <FormField id="tradingName" label="Trading name" error={errors.tradingName?.message}>
              {(field) => <Input {...field} {...form.register('tradingName')} />}
            </FormField>
            <FormField id="tin" label="TIN" help="Tax identification number" error={errors.tin?.message}>
              {(field) => <Input {...field} {...form.register('tin')} autoComplete="off" />}
            </FormField>
            <FormField id="vatNumber" label="VAT number" error={errors.vatNumber?.message}>
              {(field) => <Input {...field} {...form.register('vatNumber')} autoComplete="off" />}
            </FormField>
          </div>
          <FormField id="address" label="Address" help="One line per row, up to 6" error={errors.address?.message}>
            {(field) => <Textarea {...field} {...form.register('address')} rows={4} autoComplete="street-address" />}
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="country" label="Country" help="Two-letter code, such as NG" error={errors.country?.message}>
              {(field) => <Input {...field} {...form.register('country')} maxLength={2} className="uppercase" />}
            </FormField>
            <FormField
              id="timezone"
              label="Timezone"
              help="Used for business hours and dates on documents"
              error={errors.timezone?.message}
            >
              {(field) => (
                <NativeSelect {...field} {...form.register('timezone')}>
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replaceAll('_', ' ')}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
        </section>

        <section aria-labelledby="records-heading" className="space-y-5">
          <h2 id="records-heading" className="font-display text-lg font-bold">
            Records and brand
          </h2>
          <div className="grid gap-5 sm:grid-cols-3">
            <FormField
              id="retentionYears"
              label="Keep financial records for"
              help="Years. Confirm with your accountant."
              error={errors.retentionYears?.message}
            >
              {(field) => <Input {...field} {...form.register('retentionYears')} inputMode="numeric" />}
            </FormField>
            <FormField id="brandPrimary" label="Primary colour" error={errors.brandPrimary?.message}>
              {(field) => <Input {...field} {...form.register('brandPrimary')} className="font-mono" />}
            </FormField>
            <FormField id="brandAccent" label="Accent colour" error={errors.brandAccent?.message}>
              {(field) => <Input {...field} {...form.register('brandAccent')} className="font-mono" />}
            </FormField>
          </div>
        </section>

        <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center">
          <Button type="submit" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
          <SaveStatus state={status} />
        </div>
      </form>
    </div>
  );
}
