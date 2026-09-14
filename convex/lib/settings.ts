import { type Doc, type Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { DEFAULT_NUMBERING, type NumberedRecord, type NumberFormat } from './numbering';

// Organisation settings (04-data-model.md, orgSettings; 14-platform.md, Settings). One row. Defaults follow
// 18-open-questions.md; values the spec leaves to the studio (payment terms, quote validity, legal details) stay empty
// until they are set.

export type OrgSettingsFields = Omit<Doc<'orgSettings'>, '_id' | '_creationTime'>;

export const DEFAULT_ORG_SETTINGS: OrgSettingsFields = {
  addressLines: [],
  country: 'NG',
  defaultCurrency: 'NGN',
  timezone: 'Africa/Lagos',
  bankAccounts: [],
  numbering: {},
  defaultVatBps: 750,
  // Disabled until the accountant confirms late fees; 5% a month is the rate under review.
  lateFeePolicy: { enabled: false, monthlyBps: 500 },
  retentionYears: 7,
  brand: { primary: '#000000', accent: '#FFC400' },
};

export async function getOrgSettings(
  ctx: QueryCtx | MutationCtx,
): Promise<OrgSettingsFields & { _id?: Id<'orgSettings'> }> {
  return (await ctx.db.query('orgSettings').first()) ?? DEFAULT_ORG_SETTINGS;
}

/** The settings row, created with defaults on first write. */
export async function ensureOrgSettings(ctx: MutationCtx): Promise<Doc<'orgSettings'>> {
  const existing = await ctx.db.query('orgSettings').first();
  if (existing) return existing;
  const id = await ctx.db.insert('orgSettings', DEFAULT_ORG_SETTINGS);
  return (await ctx.db.get('orgSettings', id))!;
}

/** The number format for a record type: the studio's override, or the default from 04-data-model.md. */
export function numberFormatFor(settings: Pick<OrgSettingsFields, 'numbering'>, record: NumberedRecord): NumberFormat {
  return settings.numbering[record] ?? DEFAULT_NUMBERING[record];
}

/** Settings anyone with settings.manage sees. Bank accounts and billing defaults are not included. */
export function organisationView(settings: OrgSettingsFields) {
  return {
    legalName: settings.legalName,
    tradingName: settings.tradingName,
    addressLines: settings.addressLines,
    country: settings.country,
    tin: settings.tin,
    vatNumber: settings.vatNumber,
    timezone: settings.timezone,
    logoFileId: settings.logoFileId,
    retentionYears: settings.retentionYears,
    brand: settings.brand,
  };
}

/** Billing settings, including bank accounts. Only for settings.billing.sensitive. */
export function billingView(settings: OrgSettingsFields) {
  return {
    defaultCurrency: settings.defaultCurrency,
    bankAccounts: settings.bankAccounts,
    numbering: Object.fromEntries(
      (Object.keys(DEFAULT_NUMBERING) as NumberedRecord[]).map((record) => [record, numberFormatFor(settings, record)]),
    ) as Record<NumberedRecord, NumberFormat>,
    defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
    defaultVatBps: settings.defaultVatBps,
    lateFeePolicy: settings.lateFeePolicy,
    invoiceFooter: settings.invoiceFooter,
    quoteValidityDays: settings.quoteValidityDays,
  };
}
