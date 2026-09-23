import { ConvexError, v } from 'convex/values';
import { email, phone, website } from './lib/crm';
import { applyBps } from './lib/money';
import { deleteFile, recordUpload } from './lib/files';
import { teamMutation, teamQuery } from './lib/functions';
import { DEFAULT_NUMBERING, type NumberedRecord } from './lib/numbering';
import { billingView, ensureOrgSettings, getOrgSettings, organisationView } from './lib/settings';
import { isOwner } from './lib/team';
import { isTimeZone } from './lib/validation';

// Organisation and billing settings (14-platform.md, Settings). Organisation details need settings.manage; billing
// defaults, numbering and bank accounts need settings.billing.sensitive.

const currency = v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'));

function invalid(message: string): never {
  throw new ConvexError({ code: 'settings.invalid', message });
}

/** Runs one of the shared field checks but reports it as a settings problem, so this module speaks with one code. */
function checked<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    invalid(
      error instanceof ConvexError ? String((error.data as { message?: string }).message) : 'That value is not valid',
    );
  }
}

function optionalText(value: string | undefined, label: string, max = 200): string | undefined {
  const trimmed = value?.trim();
  if (trimmed && trimmed.length > max) invalid(`${label} can be at most ${max} characters`);
  return trimmed || undefined;
}

function wholeDays(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 365)
    invalid(`${label} must be a whole number of days, 0 to 365`);
  return value;
}

export const getOrganisation = teamQuery('settings.manage')({
  args: {},
  handler: async (ctx) => organisationView(await getOrgSettings(ctx)),
});

export const updateOrganisation = teamMutation('settings.manage')({
  args: {
    legalName: v.optional(v.string()),
    tradingName: v.optional(v.string()),
    addressLines: v.array(v.string()),
    country: v.string(),
    tin: v.optional(v.string()),
    vatNumber: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    timezone: v.string(),
    retentionYears: v.number(),
    brand: v.object({ primary: v.string(), accent: v.string() }),
  },
  handler: async (ctx, args) => {
    if (!/^[A-Z]{2}$/.test(args.country)) invalid('Country must be a two-letter ISO code, such as NG');
    if (!isTimeZone(args.timezone)) invalid(`"${args.timezone}" is not a timezone`);
    if (!Number.isInteger(args.retentionYears) || args.retentionYears < 1 || args.retentionYears > 50) {
      invalid('Retention must be a whole number of years, 1 to 50');
    }
    const hex = /^#[0-9a-f]{6}$/i;
    if (!hex.test(args.brand.primary) || !hex.test(args.brand.accent))
      invalid('Brand colours must be hex, such as #11297A');
    const addressLines = args.addressLines.map((line) => line.trim()).filter(Boolean);
    if (addressLines.length > 6) invalid('Use at most 6 address lines');

    const settings = await ensureOrgSettings(ctx);
    await ctx.db.patch('orgSettings', settings._id, {
      legalName: optionalText(args.legalName, 'Legal name'),
      tradingName: optionalText(args.tradingName, 'Trading name'),
      addressLines: addressLines.map((line) => optionalText(line, 'Address line', 120)!),
      country: args.country,
      tin: optionalText(args.tin, 'TIN', 40),
      vatNumber: optionalText(args.vatNumber, 'VAT number', 40),
      // The same checks contacts get: a real address, an international number, a resolvable site.
      email: args.email?.trim() ? checked(() => email(args.email!)) : undefined,
      phone: checked(() => phone(args.phone, 'Phone')),
      website: checked(() => website(args.website)),
      timezone: args.timezone,
      retentionYears: args.retentionYears,
      brand: { primary: args.brand.primary.toUpperCase(), accent: args.brand.accent.toUpperCase() },
    });
  },
});

/**
 * Whether counsel has reviewed the signing process (07-documents-and-esign.md, Legal note). It is a statement anyone
 * working with documents may need to see, and only the Owner may make or withdraw.
 */
export const signatureProcessReview = teamQuery(null)({
  args: {},
  handler: async (ctx) => {
    const review = (await getOrgSettings(ctx)).signatureProcessReview;
    if (!review) return { reviewed: false as const };
    const reviewer = await ctx.db.get('teamMembers', review.reviewedByMemberId);
    return {
      reviewed: true as const,
      reviewedAt: review.reviewedAt,
      reviewedByName: reviewer?.name ?? 'Former member',
      note: review.note,
    };
  },
});

export const setSignatureProcessReview = teamMutation(null)({
  args: { reviewed: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, { reviewed, note }) => {
    if (!isOwner(ctx.principal.role)) {
      throw new ConvexError({
        code: 'settings.ownerOnly',
        message: 'Only the Owner can record that counsel reviewed the signing process',
      });
    }
    const settings = await ensureOrgSettings(ctx);
    await ctx.db.patch('orgSettings', settings._id, {
      signatureProcessReview: reviewed
        ? {
            reviewedAt: Date.now(),
            reviewedByMemberId: ctx.principal.member._id,
            note: optionalText(note, 'Note', 500),
          }
        : undefined,
    });
  },
});

export const getBilling = teamQuery('settings.billing.sensitive')({
  args: {},
  handler: async (ctx) => billingView(await getOrgSettings(ctx)),
});

export const updateBilling = teamMutation('settings.billing.sensitive')({
  args: {
    defaultCurrency: currency,
    bankAccounts: v.array(
      v.object({
        label: v.string(),
        currency,
        bankName: v.string(),
        accountName: v.string(),
        accountNumber: v.string(),
        swift: v.optional(v.string()),
        iban: v.optional(v.string()),
        sortCode: v.optional(v.string()),
      }),
    ),
    numbering: v.record(v.string(), v.object({ prefix: v.string(), padding: v.number() })),
    defaultPaymentTermsDays: v.optional(v.number()),
    defaultVatBps: v.number(),
    lateFeePolicy: v.object({
      enabled: v.boolean(),
      monthlyBps: v.number(),
      graceDays: v.optional(v.number()),
      autoSend: v.optional(v.boolean()),
    }),
    invoiceFooter: v.optional(v.string()),
    quoteValidityDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // applyBps rejects anything outside 0–100% before it is stored.
    applyBps(0, args.defaultVatBps);
    applyBps(0, args.lateFeePolicy.monthlyBps);

    for (const [record, format] of Object.entries(args.numbering)) {
      if (!(record in DEFAULT_NUMBERING)) invalid(`Unknown record type "${record}"`);
      if (!/^[A-Za-z0-9/_-]{1,20}$/.test(format.prefix)) {
        invalid(`The ${record} prefix may use letters, digits, / _ and -, up to 20 characters`);
      }
      if (!Number.isInteger(format.padding) || format.padding < 1 || format.padding > 10) {
        invalid(`The ${record} padding must be 1 to 10 digits`);
      }
    }

    if (args.bankAccounts.length > 10) invalid('Use at most 10 bank accounts');
    const bankAccounts = args.bankAccounts.map((account) => {
      const required = (value: string, label: string) =>
        optionalText(value, label, 120) ?? invalid(`${label} is required`);
      return {
        label: required(account.label, 'Account label'),
        currency: account.currency,
        bankName: required(account.bankName, 'Bank name'),
        accountName: required(account.accountName, 'Account name'),
        accountNumber: required(account.accountNumber, 'Account number'),
        swift: optionalText(account.swift, 'SWIFT', 20),
        iban: optionalText(account.iban, 'IBAN', 40),
        sortCode: optionalText(account.sortCode, 'Sort code', 20),
      };
    });

    const settings = await ensureOrgSettings(ctx);
    await ctx.db.patch('orgSettings', settings._id, {
      defaultCurrency: args.defaultCurrency,
      bankAccounts,
      numbering: args.numbering as Record<NumberedRecord, { prefix: string; padding: number }>,
      defaultPaymentTermsDays: wholeDays(args.defaultPaymentTermsDays, 'Payment terms'),
      defaultVatBps: args.defaultVatBps,
      lateFeePolicy: { ...args.lateFeePolicy, graceDays: wholeDays(args.lateFeePolicy.graceDays, 'Grace period') },
      invoiceFooter: optionalText(args.invoiceFooter, 'Invoice footer', 1000),
      quoteValidityDays: wholeDays(args.quoteValidityDays, 'Quote validity'),
    });
  },
});

export const generateLogoUploadUrl = teamMutation('settings.manage')({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const setLogo = teamMutation('settings.manage')({
  args: { storageId: v.id('_storage'), name: v.string(), contentType: v.string() },
  handler: async (ctx, { storageId, name, contentType }) => {
    const settings = await ensureOrgSettings(ctx);
    const result = await recordUpload(ctx, {
      storageId,
      name,
      contentType,
      context: 'image',
      owner: { table: 'orgSettings', id: settings._id },
      visibility: 'internal',
      uploadedBy: { kind: 'team', id: ctx.principal.member._id },
    });
    if (!result.ok) return result;
    await ctx.db.patch('orgSettings', settings._id, { logoFileId: result.fileId });
    if (settings.logoFileId) await deleteFile(ctx, settings.logoFileId);
    return result;
  },
});

export const removeLogo = teamMutation('settings.manage')({
  args: {},
  handler: async (ctx) => {
    const settings = await ensureOrgSettings(ctx);
    if (!settings.logoFileId) return;
    await ctx.db.patch('orgSettings', settings._id, { logoFileId: undefined });
    await deleteFile(ctx, settings.logoFileId);
  },
});
