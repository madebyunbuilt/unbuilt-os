import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { text } from './lib/crm';
import { billError } from './lib/bills';
import { teamMutation, teamQuery } from './lib/functions';
import { applyBps } from './lib/money';
import { notFound } from './lib/projects';
import { type TeamPrincipal } from './lib/principals';

// Vendors (08-billing-and-finance.md, Vendors and bills): the contractors and suppliers the studio pays. Bank details
// are sensitive — redacted in the audit log, and returned only to the people who pay bills or keep the vendor records.

/** Bank details reach the people who enter them and the people who pay from them, and nobody else. */
const canSeeBankDetails = (principal: TeamPrincipal) =>
  principal.permissions.has('bills.pay') || principal.permissions.has('vendors.manage');

function vendorView(vendor: Doc<'vendors'>, principal: TeamPrincipal) {
  return {
    id: vendor._id,
    name: vendor.name,
    kind: vendor.kind,
    memberId: vendor.memberId,
    email: vendor.email,
    phone: vendor.phone,
    tin: vendor.tin,
    whtBps: vendor.whtBps,
    notes: vendor.notes,
    status: vendor.status,
    bankDetails: canSeeBankDetails(principal) ? vendor.bankDetails : undefined,
    // So a screen can say the details are there without showing them.
    hasBankDetails: Boolean(vendor.bankDetails),
  };
}

export async function getVendor(ctx: QueryCtx | MutationCtx, vendorId: Id<'vendors'>) {
  const vendor = await ctx.db.get('vendors', vendorId);
  if (!vendor) throw notFound('Vendor');
  return vendor;
}

export const list = teamQuery('vendors.manage')({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { includeArchived }) => {
    const rows = await ctx.db.query('vendors').take(1000);
    return rows
      .filter((row) => includeArchived || row.status === 'active')
      .map((row) => vendorView(row, ctx.principal))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const get = teamQuery('vendors.manage')({
  args: { vendorId: v.id('vendors') },
  handler: async (ctx, { vendorId }) => vendorView(await getVendor(ctx, vendorId), ctx.principal),
});

const details = {
  name: v.string(),
  kind: v.union(v.literal('contractor'), v.literal('supplier')),
  memberId: v.optional(v.id('teamMembers')),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  bankDetails: v.optional(
    v.object({
      bankName: v.string(),
      accountName: v.string(),
      accountNumber: v.string(),
      swift: v.optional(v.string()),
      iban: v.optional(v.string()),
    }),
  ),
  tin: v.optional(v.string()),
  whtBps: v.optional(v.number()),
  notes: v.optional(v.string()),
};

function checkedDetails(args: { name: string; whtBps?: number; notes?: string; email?: string }) {
  if (args.whtBps !== undefined) {
    if (!Number.isInteger(args.whtBps) || args.whtBps < 0 || args.whtBps > 10_000) {
      throw billError('bills.invalid', 'A withholding rate is a percentage between 0 and 100');
    }
    // Checked here so an impossible rate is refused before it reaches a payment.
    applyBps(0, args.whtBps);
  }
  return {
    name: text(args.name, 'Name', { required: true, max: 200 })!,
    email: text(args.email, 'Email', { max: 200 }),
    notes: text(args.notes, 'Notes', { max: 2000 }),
  };
}

export const create = teamMutation('vendors.manage')({
  args: details,
  handler: async (ctx, args) => {
    const checked = checkedDetails(args);
    return await ctx.db.insert('vendors', {
      ...args,
      ...checked,
      status: 'active',
      createdByMemberId: ctx.principal.member._id,
    });
  },
});

export const update = teamMutation('vendors.manage')({
  args: { vendorId: v.id('vendors'), ...details },
  handler: async (ctx, { vendorId, ...args }) => {
    await getVendor(ctx, vendorId);
    await ctx.db.patch('vendors', vendorId, { ...args, ...checkedDetails(args) });
  },
});

/** Archived rather than deleted: the bills paid to them stay on record. */
export const setStatus = teamMutation('vendors.manage')({
  args: { vendorId: v.id('vendors'), status: v.union(v.literal('active'), v.literal('archived')) },
  handler: async (ctx, { vendorId, status }) => {
    await getVendor(ctx, vendorId);
    await ctx.db.patch('vendors', vendorId, { status });
  },
});
