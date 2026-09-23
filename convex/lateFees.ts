import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { recordActivity, text } from './lib/crm';
import { internalMutation, teamMutation } from './lib/functions';
import { localDateString } from './lib/businessTime';
import { draftInvoice, getInvoice, OPEN_STATUSES, studioToday, TYPE_LABELS } from './lib/invoices';
import { lateFeeDue, lateFeeError } from './lib/lateFees';
import { formatBpsAsPercent, formatMoney } from './lib/money';
import { notifyTeamMembers } from './lib/notify';
import { getOrgSettings } from './lib/settings';

// Late fees (08-billing-and-finance.md, Late fees). Once a day, an invoice still unpaid after its due date and the
// grace period earns a monthly fee on what is still owed. The fee is its own invoice, linked to the one it is for, so
// the original is never rewritten; it carries no VAT (studio, 2026-09-23) and nothing compounds.

const longDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(Date.parse(`${value}T00:00:00Z`));

/** The late fees already raised for an invoice, newest first. */
async function feesFor(ctx: MutationCtx, invoiceId: Id<'invoices'>) {
  const fees = await ctx.db
    .query('invoices')
    .withIndex('by_late_fee_parent', (q) => q.eq('lateFeeParentInvoiceId', invoiceId))
    .collect();
  return fees.sort((a, b) => b._creationTime - a._creationTime);
}

/** Raises one late fee invoice for what an overdue invoice still owes. */
async function raiseLateFee(
  ctx: MutationCtx,
  invoice: Doc<'invoices'>,
  amountMinor: number,
  monthlyBps: number,
  today: string,
): Promise<Id<'invoices'>> {
  const invoiceId = await draftInvoice(ctx, {
    clientId: invoice.clientId,
    projectId: invoice.projectId,
    type: 'late_fee',
    currency: invoice.currency,
    lineItems: [
      {
        description: `Late payment fee on ${invoice.number} at ${formatBpsAsPercent(monthlyBps)}% a month, ${formatMoney(invoice.balanceMinor, invoice.currency)} outstanding on ${longDate(today)}`,
        quantityMilli: 1_000,
        unitPriceMinor: amountMinor,
        amountMinor,
        taxable: false,
      },
    ],
    // A late fee is a charge for being paid late, not a service: no VAT, and nothing to withhold tax against.
    vat: { applies: false, bps: 0 },
    wht: { applies: false, bps: 0 },
    fxRateToNgnMicro: invoice.fxRateToNgnMicro,
    createdByMemberId: invoice.createdByMemberId,
  });
  await ctx.db.patch('invoices', invoiceId, { lateFeeParentInvoiceId: invoice._id });
  await recordActivity(ctx, {
    subject: { table: 'clients', id: invoice.clientId },
    clientId: invoice.clientId,
    type: 'system',
    title: `Late fee raised on ${invoice.number}: ${formatMoney(amountMinor, invoice.currency)}`,
    actor: { kind: 'system' },
    meta: { invoiceId, parentInvoiceId: invoice._id },
  });
  return invoiceId;
}

/** Daily: every open invoice past its grace period earns this month's fee, at most one per invoice per month. */
export const runDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ raised: number }> => {
    const settings = await getOrgSettings(ctx);
    const policy = settings.lateFeePolicy;
    if (!policy.enabled) return { raised: 0 };
    const today = await studioToday(ctx);
    let raised = 0;

    for (const status of OPEN_STATUSES) {
      const invoices = await ctx.db
        .query('invoices')
        .withIndex('by_status_due', (q) => q.eq('status', status))
        .collect();
      for (const invoice of invoices) {
        // A late fee never earns a late fee of its own, which is what keeps them from compounding.
        if (invoice.type === 'late_fee' || invoice.noReminders) continue;
        const client = await ctx.db.get('clients', invoice.clientId);
        if (!client || client.noReminders) continue;
        const previous = await feesFor(ctx, invoice._id);
        // A fee still in drafts has no issue date yet, so the day it was raised is what holds the month open.
        const last = previous.find((fee) => fee.status !== 'void');
        const chargedOn = last && (last.issueDate ?? localDateString(last._creationTime, settings.timezone));
        const due = lateFeeDue(invoice, policy, today, chargedOn);
        if (!due) continue;

        const feeId = await raiseLateFee(ctx, invoice, due.amountMinor, policy.monthlyBps, today);
        raised++;
        if (policy.autoSend) {
          await ctx.scheduler.runAfter(0, internal.invoiceSending.send, {
            invoiceId: feeId,
            memberId: invoice.createdByMemberId,
          });
        } else {
          await notifyTeamMembers(ctx, [invoice.createdByMemberId], {
            event: 'late_fee_raised',
            title: `A late fee on ${invoice.number} is ready to send`,
            body: `${formatMoney(due.amountMinor, invoice.currency)} on ${formatMoney(invoice.balanceMinor, invoice.currency)} still owed.`,
            link: `/billing/invoices/${feeId}`,
          });
        }
      }
    }
    return { raised };
  },
});

/**
 * Lets a late fee go, with a reason (08-billing-and-finance.md). Voiding it rather than deleting keeps the number and
 * the record, and the next month's fee then dates from the one before it.
 */
export const waive = teamMutation('invoices.latefees.waive')({
  args: { invoiceId: v.id('invoices'), reason: v.string() },
  handler: async (ctx, { invoiceId, reason }) => {
    const invoice = await getInvoice(ctx, invoiceId);
    if (invoice.type !== 'late_fee') {
      throw lateFeeError('lateFees.notLateFee', `A ${TYPE_LABELS[invoice.type].toLowerCase()} is not waived`);
    }
    if (!OPEN_STATUSES.has(invoice.status) && invoice.status !== 'draft') {
      throw lateFeeError('lateFees.closed', `A ${invoice.status.replace('_', ' ')} late fee cannot be waived`);
    }
    if (invoice.paidMinor > 0 || invoice.creditedMinor > 0) {
      throw lateFeeError('lateFees.paid', 'This late fee has money against it; credit it instead');
    }
    await ctx.db.patch('invoices', invoiceId, {
      status: 'void',
      voidReason: text(reason, 'Reason', { required: true, max: 500 }),
      voidedAt: Date.now(),
      balanceMinor: 0,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'system',
      title: `Late fee ${invoice.number ?? ''} waived`.trim(),
      body: reason,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId },
    });
  },
});
