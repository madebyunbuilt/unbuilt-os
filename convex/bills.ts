import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { text } from './lib/crm';
import { assertBillAmounts, assertEditable, assertPayable, billError, billSplit, DUE_SOON_DAYS } from './lib/bills';
import { recordUpload } from './lib/files';
import { internalMutation, teamMutation, teamQuery } from './lib/functions';
import { addDays, latestFxRate, studioToday } from './lib/invoices';
import { formatMoney, MICRO_PER_UNIT } from './lib/money';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { notFound } from './lib/projects';
import { getOrgSettings } from './lib/settings';
import { isIsoDate } from './lib/validation';
import { getVendor } from './vendors';

// Bills (08-billing-and-finance.md, Vendors and bills). What the studio owes a contractor or supplier: draft →
// approved → scheduled → paid, or void. Paying one deducts the withholding tax the studio owes on the vendor's behalf,
// so the vendor is paid the bill less that tax and the deduction is kept for remittance.

async function getBill(ctx: QueryCtx | MutationCtx, billId: Id<'bills'>) {
  const bill = await ctx.db.get('bills', billId);
  if (!bill) throw notFound('Bill');
  return bill;
}

function billView(bill: Doc<'bills'>, vendor: Doc<'vendors'> | null) {
  const split = billSplit(bill, vendor?.whtBps);
  return {
    id: bill._id,
    vendorId: bill.vendorId,
    vendorName: vendor?.name,
    projectId: bill.projectId,
    reference: bill.reference,
    description: bill.description,
    amountMinor: bill.amountMinor,
    vatMinor: bill.vatMinor ?? 0,
    currency: bill.currency,
    issueDate: bill.issueDate,
    dueDate: bill.dueDate,
    status: bill.status,
    scheduledFor: bill.scheduledFor,
    fileId: bill.fileId,
    // What would be withheld and paid if it were paid now, so the screen shows it before anyone commits.
    whtMinor: bill.whtMinor ?? split.whtMinor,
    payableMinor: bill.paidMinor ?? split.payableMinor,
    paidOn: bill.paidOn,
    paymentReference: bill.paymentReference,
    voidReason: bill.voidReason,
  };
}

export const list = teamQuery('bills.manage')({
  args: { status: v.optional(v.string()), vendorId: v.optional(v.id('vendors')) },
  handler: async (ctx, args) => {
    const rows = args.vendorId
      ? await ctx.db
          .query('bills')
          .withIndex('by_vendor', (q) => q.eq('vendorId', args.vendorId!))
          .collect()
      : await ctx.db.query('bills').take(1000);
    const filtered = rows.filter((row) => !args.status || row.status === args.status);
    const views = await Promise.all(
      filtered.map(async (row) => billView(row, await ctx.db.get('vendors', row.vendorId))),
    );
    return views.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  },
});

export const get = teamQuery('bills.manage')({
  args: { billId: v.id('bills') },
  handler: async (ctx, { billId }) => {
    const bill = await getBill(ctx, billId);
    return billView(bill, await ctx.db.get('vendors', bill.vendorId));
  },
});

const details = {
  vendorId: v.id('vendors'),
  projectId: v.optional(v.id('projects')),
  reference: v.string(),
  description: v.string(),
  amountMinor: v.number(),
  vatMinor: v.optional(v.number()),
  currency: v.optional(v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'))),
  issueDate: v.string(),
  dueDate: v.string(),
};

function checkedDates(issueDate: string, dueDate: string) {
  if (!isIsoDate(issueDate) || !isIsoDate(dueDate)) throw billError('bills.invalid', 'Give the dates on the bill');
  if (dueDate < issueDate) throw billError('bills.invalid', 'A bill cannot be due before it was issued');
  return { issueDate, dueDate };
}

export const create = teamMutation('bills.manage')({
  args: details,
  handler: async (ctx, args) => {
    const vendor = await getVendor(ctx, args.vendorId);
    if (vendor.status !== 'active') throw billError('bills.archived', 'That vendor is archived');
    assertBillAmounts(args);
    const settings = await getOrgSettings(ctx);
    const currency = args.currency ?? settings.defaultCurrency;
    const dates = checkedDates(args.issueDate, args.dueDate);
    const rate = await latestFxRate(ctx, currency, dates.issueDate);
    if (!rate) {
      throw billError('bills.noRate', `There is no ${currency} rate on or before ${dates.issueDate}. Set one first.`);
    }
    return await ctx.db.insert('bills', {
      vendorId: vendor._id,
      projectId: args.projectId,
      reference: text(args.reference, 'Reference', { required: true, max: 100 })!,
      description: text(args.description, 'Description', { required: true, max: 500 })!,
      amountMinor: args.amountMinor,
      vatMinor: args.vatMinor,
      currency,
      fxRateToNgnMicro: rate.rateToNgnMicro ?? MICRO_PER_UNIT,
      ...dates,
      status: 'draft',
      createdByMemberId: ctx.principal.member._id,
    });
  },
});

export const update = teamMutation('bills.manage')({
  args: { billId: v.id('bills'), ...details },
  handler: async (ctx, { billId, ...args }) => {
    const bill = await getBill(ctx, billId);
    assertEditable(bill);
    await getVendor(ctx, args.vendorId);
    assertBillAmounts(args);
    await ctx.db.patch('bills', billId, {
      vendorId: args.vendorId,
      projectId: args.projectId,
      reference: text(args.reference, 'Reference', { required: true, max: 100 })!,
      description: text(args.description, 'Description', { required: true, max: 500 })!,
      amountMinor: args.amountMinor,
      vatMinor: args.vatMinor,
      ...checkedDates(args.issueDate, args.dueDate),
    });
  },
});

export const remove = teamMutation('bills.manage')({
  args: { billId: v.id('bills') },
  handler: async (ctx, { billId }) => {
    const bill = await getBill(ctx, billId);
    if (bill.status !== 'draft') throw billError('bills.closed', 'A bill that has been approved stays on record');
    await ctx.db.delete('bills', billId);
  },
});

export const generateUploadUrl = teamMutation('bills.manage')({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** The vendor's own invoice, kept with the bill. */
export const attachFile = teamMutation('bills.manage')({
  args: { billId: v.id('bills'), storageId: v.id('_storage'), name: v.string(), contentType: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const bill = await getBill(ctx, args.billId);
    const upload = await recordUpload(ctx, {
      storageId: args.storageId,
      name: args.name,
      contentType: args.contentType,
      context: 'document',
      owner: { table: 'bills', id: bill._id },
      visibility: 'internal',
      projectId: bill.projectId,
      uploadedBy: { kind: 'team', id: ctx.principal.member._id },
    });
    if (!upload.ok) return { ok: false, message: upload.message };
    await ctx.db.patch('bills', bill._id, { fileId: upload.fileId });
    return { ok: true };
  },
});

/** Approving a bill says the studio owes it; scheduling says which day it will go out. */
export const approve = teamMutation('bills.manage')({
  args: { billId: v.id('bills') },
  handler: async (ctx, { billId }) => {
    const bill = await getBill(ctx, billId);
    if (bill.status !== 'draft') throw billError('bills.closed', `A ${bill.status} bill is not approved again`);
    await ctx.db.patch('bills', billId, { status: 'approved', approvedByMemberId: ctx.principal.member._id });
  },
});

export const schedule = teamMutation('bills.pay')({
  args: { billId: v.id('bills'), scheduledFor: v.string() },
  handler: async (ctx, { billId, scheduledFor }) => {
    const bill = await getBill(ctx, billId);
    if (bill.status !== 'approved' && bill.status !== 'scheduled') {
      throw billError('bills.notApproved', 'Approve the bill before scheduling it');
    }
    if (!isIsoDate(scheduledFor)) throw billError('bills.invalid', 'Give the day it will be paid');
    await ctx.db.patch('bills', billId, { status: 'scheduled', scheduledFor });
  },
});

export const voidBill = teamMutation('bills.manage')({
  args: { billId: v.id('bills'), reason: v.string() },
  handler: async (ctx, { billId, reason }) => {
    const bill = await getBill(ctx, billId);
    if (bill.status === 'paid') throw billError('bills.paid', 'A paid bill is not voided');
    await ctx.db.patch('bills', billId, {
      status: 'void',
      voidReason: text(reason, 'Reason', { required: true, max: 500 })!,
    });
  },
});

/**
 * Paying a vendor. The studio withholds what the vendor's rate says on the amount before their VAT, pays the rest, and
 * keeps the deduction: that money belongs to the tax authority and the studio remits it on the vendor's behalf.
 * A rate typed here overrides the vendor's, for the times a particular bill is treated differently.
 */
export const pay = teamMutation('bills.pay')({
  args: {
    billId: v.id('bills'),
    paidOn: v.string(),
    paymentReference: v.optional(v.string()),
    whtBpsOverride: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const bill = await getBill(ctx, args.billId);
    assertPayable(bill);
    const vendor = await getVendor(ctx, bill.vendorId);
    if (!isIsoDate(args.paidOn)) throw billError('bills.invalid', 'Give the day it was paid');
    if (args.paidOn > (await studioToday(ctx))) {
      throw billError('bills.future', 'A payment cannot be in the future');
    }
    const bps = args.whtBpsOverride ?? vendor.whtBps;
    if (bps !== undefined && (!Number.isInteger(bps) || bps < 0 || bps > 10_000)) {
      throw billError('bills.invalid', 'A withholding rate is a percentage between 0 and 100');
    }
    const { whtMinor, payableMinor } = billSplit(bill, bps);
    await ctx.db.patch('bills', args.billId, {
      status: 'paid',
      whtMinor,
      paidMinor: payableMinor,
      paidOn: args.paidOn,
      paidAt: Date.now(),
      paymentReference: text(args.paymentReference, 'Reference', { max: 200 }),
      paidByMemberId: ctx.principal.member._id,
    });
    return { whtMinor, payableMinor };
  },
});

/** What the studio withheld from vendors in a range, which is what it owes the tax authority. */
export const whtToRemit = teamQuery('reports.finance.view')({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const rows = await ctx.db
      .query('bills')
      .withIndex('by_paid_on', (q) => q.gte('paidOn', from).lte('paidOn', to))
      .collect();
    const paid = rows.filter((row) => row.status === 'paid' && (row.whtMinor ?? 0) > 0);
    const lines = await Promise.all(
      paid.map(async (row) => {
        const vendor = await ctx.db.get('vendors', row.vendorId);
        return {
          billId: row._id,
          vendorName: vendor?.name ?? 'Unknown vendor',
          vendorTin: vendor?.tin,
          reference: row.reference,
          paidOn: row.paidOn!,
          currency: row.currency,
          amountMinor: row.amountMinor,
          whtMinor: row.whtMinor!,
        };
      }),
    );
    const byCurrency: Record<string, number> = {};
    for (const line of lines) byCurrency[line.currency] = (byCurrency[line.currency] ?? 0) + line.whtMinor;
    return { lines: lines.sort((a, b) => a.paidOn.localeCompare(b.paidOn)), byCurrency };
  },
});

/** Daily: tells the people who pay about bills due within the week, and any that are already late. */
export const remindDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ due: number; overdue: number }> => {
    const today = await studioToday(ctx);
    const horizon = addDays(today, DUE_SOON_DAYS);
    const payers = await activeMembersWith(ctx, 'bills.pay');
    if (payers.length === 0) return { due: 0, overdue: 0 };

    const waiting = [
      ...(await ctx.db
        .query('bills')
        .withIndex('by_status_due', (q) => q.eq('status', 'approved').lte('dueDate', horizon))
        .collect()),
      ...(await ctx.db
        .query('bills')
        .withIndex('by_status_due', (q) => q.eq('status', 'scheduled').lte('dueDate', horizon))
        .collect()),
    ];
    const overdue = waiting.filter((bill) => bill.dueDate < today);
    const due = waiting.filter((bill) => bill.dueDate >= today);
    if (waiting.length === 0) return { due: 0, overdue: 0 };

    const total = waiting.reduce((sum, bill) => sum + bill.amountMinor, 0);
    const currency = waiting[0].currency;
    const sameCurrency = waiting.every((bill) => bill.currency === currency);
    await notifyTeamMembers(ctx, payers, {
      event: 'bills_due',
      title:
        overdue.length > 0
          ? `${overdue.length} bill${overdue.length === 1 ? ' is' : 's are'} overdue`
          : `${due.length} bill${due.length === 1 ? '' : 's'} due within ${DUE_SOON_DAYS} days`,
      body: sameCurrency
        ? `${formatMoney(total, currency)} in total.`
        : `${waiting.length} bills, in more than one currency.`,
      link: '/billing/bills',
    });
    return { due: due.length, overdue: overdue.length };
  },
});
