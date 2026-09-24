import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { recordActivity, text } from './lib/crm';
import { authError } from './lib/principals';
import {
  assertBillable,
  assertBillableHasProject,
  assertDecidable,
  CATEGORY_LABELS,
  EDITABLE,
  EXPENSE_CATEGORIES,
  expenseError,
  rechargeMinor,
} from './lib/expenses';
import { recordUpload } from './lib/files';
import { internalQuery, teamMutation, teamQuery } from './lib/functions';
import { invoiceTotals, latestFxRate, studioToday } from './lib/invoices';
import { formatMoney, MICRO_PER_UNIT } from './lib/money';
import { activeMembersWith, notifyTeamMembers } from './lib/notify';
import { notFound, visibleProject } from './lib/projects';
import { getOrgSettings } from './lib/settings';
import { isIsoDate } from './lib/validation';

// Expenses (08-billing-and-finance.md, Expenses). A member logs what they spent with its receipt, an approver decides,
// and an approved billable expense joins a draft invoice at cost — the studio recharges what it paid unless it has set
// a markup. Rejected and reimbursed expenses stay on record either way.

const category = v.union(...EXPENSE_CATEGORIES.map((name) => v.literal(name)));

function expenseView(
  expense: Doc<'expenses'>,
  extras: { loggedByName?: string; projectName?: string; isMine?: boolean } = {},
) {
  return {
    id: expense._id,
    projectId: expense.projectId,
    projectName: extras.projectName,
    clientId: expense.clientId,
    category: expense.category,
    categoryLabel: CATEGORY_LABELS[expense.category as keyof typeof CATEGORY_LABELS] ?? expense.category,
    description: expense.description,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    date: expense.date,
    receiptFileId: expense.receiptFileId,
    billable: expense.billable,
    reimbursable: expense.reimbursable,
    reimbursedAt: expense.reimbursedAt,
    status: expense.status,
    decisionNote: expense.decisionNote,
    loggedByMemberId: expense.loggedByMemberId,
    loggedByName: extras.loggedByName,
    // Whose it is, so a screen can offer the things only the person who logged it may do.
    isMine: extras.isMine ?? false,
    invoiceId: expense.invoiceId,
    createdAt: expense._creationTime,
  };
}

async function getExpense(ctx: QueryCtx | MutationCtx, expenseId: Id<'expenses'>) {
  const expense = await ctx.db.get('expenses', expenseId);
  if (!expense) throw notFound('Expense');
  return expense;
}

/** Reading expenses: anyone who logs them, and anyone who approves them (Finance does not log its own). */
function assertCanRead(principal: { permissions: ReadonlySet<string> }) {
  if (!principal.permissions.has('expenses.log') && !principal.permissions.has('expenses.approve')) {
    throw authError('auth.forbidden', 'You do not have access to this');
  }
}

/** A member always sees their own; an approver sees them all. */
function visible(rows: Doc<'expenses'>[], principal: { member: Doc<'teamMembers'>; permissions: ReadonlySet<string> }) {
  if (principal.permissions.has('expenses.approve')) return rows;
  return rows.filter((row) => row.loggedByMemberId === principal.member._id);
}

export const list = teamQuery(null)({
  args: {
    status: v.optional(v.string()),
    projectId: v.optional(v.id('projects')),
    mine: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertCanRead(ctx.principal);
    const rows = args.projectId
      ? await ctx.db
          .query('expenses')
          .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
          .collect()
      : await ctx.db.query('expenses').take(1000);
    const allowed = visible(rows, ctx.principal);
    const filtered = allowed.filter(
      (row) =>
        (!args.status || row.status === args.status) &&
        (!args.mine || row.loggedByMemberId === ctx.principal.member._id),
    );
    const views = await Promise.all(
      filtered.map(async (row) => {
        const [member, project] = await Promise.all([
          ctx.db.get('teamMembers', row.loggedByMemberId),
          row.projectId ? ctx.db.get('projects', row.projectId) : null,
        ]);
        return expenseView(row, {
          loggedByName: member?.name,
          projectName: project?.name,
          isMine: row.loggedByMemberId === ctx.principal.member._id,
        });
      }),
    );
    return views.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  },
});

export const get = teamQuery(null)({
  args: { expenseId: v.id('expenses') },
  handler: async (ctx, { expenseId }) => {
    assertCanRead(ctx.principal);
    const expense = await getExpense(ctx, expenseId);
    if (expense.loggedByMemberId !== ctx.principal.member._id && !ctx.principal.permissions.has('expenses.approve')) {
      throw notFound('Expense');
    }
    const [member, project] = await Promise.all([
      ctx.db.get('teamMembers', expense.loggedByMemberId),
      expense.projectId ? ctx.db.get('projects', expense.projectId) : null,
    ]);
    return expenseView(expense, {
      loggedByName: member?.name,
      projectName: project?.name,
      isMine: expense.loggedByMemberId === ctx.principal.member._id,
    });
  },
});

const details = {
  projectId: v.optional(v.id('projects')),
  category,
  description: v.string(),
  amountMinor: v.number(),
  currency: v.optional(v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'))),
  date: v.string(),
  billable: v.optional(v.boolean()),
  reimbursable: v.optional(v.boolean()),
};

function checkedAmount(amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw expenseError('expenses.invalid', 'An expense needs a whole amount above zero');
  }
  return amountMinor;
}

async function checkedDate(ctx: QueryCtx | MutationCtx, date: string) {
  if (!isIsoDate(date)) throw expenseError('expenses.invalid', 'Give the date it was spent');
  if (date > (await studioToday(ctx))) throw expenseError('expenses.future', 'An expense cannot be in the future');
  return date;
}

/** Anyone who logs time logs expenses: their own, against a project they can see. */
export const log = teamMutation('expenses.log')({
  args: details,
  handler: async (ctx, args) => {
    assertBillableHasProject(args);
    const project = args.projectId ? await visibleProject(ctx, ctx.principal, args.projectId) : null;
    const settings = await getOrgSettings(ctx);
    const currency = args.currency ?? project?.currency ?? settings.defaultCurrency;
    const date = await checkedDate(ctx, args.date);
    // The rate on the day it was spent, so a report in NGN does not move when today's rate does.
    const rate = await latestFxRate(ctx, currency, date);
    if (!rate) {
      throw expenseError('expenses.noRate', `There is no ${currency} rate on or before ${date}. Set one first.`);
    }
    return await ctx.db.insert('expenses', {
      projectId: project?._id,
      clientId: project?.clientId,
      category: args.category,
      description: text(args.description, 'Description', { required: true, max: 500 })!,
      amountMinor: checkedAmount(args.amountMinor),
      currency,
      fxRateToNgnMicro: rate.rateToNgnMicro ?? MICRO_PER_UNIT,
      date,
      billable: args.billable ?? false,
      reimbursable: args.reimbursable ?? false,
      status: 'logged',
      loggedByMemberId: ctx.principal.member._id,
    });
  },
});

export const update = teamMutation('expenses.log')({
  args: { expenseId: v.id('expenses'), ...details },
  handler: async (ctx, { expenseId, ...args }) => {
    const expense = await getExpense(ctx, expenseId);
    if (expense.loggedByMemberId !== ctx.principal.member._id) {
      throw expenseError('expenses.notYours', 'You change your own expenses; an approver decides on the rest');
    }
    if (!EDITABLE.has(expense.status)) {
      throw expenseError('expenses.decided', `This expense has been ${expense.status} and no longer changes`);
    }
    assertBillableHasProject({ billable: args.billable ?? expense.billable, projectId: args.projectId });
    const project = args.projectId ? await visibleProject(ctx, ctx.principal, args.projectId) : null;
    await ctx.db.patch('expenses', expenseId, {
      projectId: project?._id,
      clientId: project?.clientId,
      category: args.category,
      description: text(args.description, 'Description', { required: true, max: 500 })!,
      amountMinor: checkedAmount(args.amountMinor),
      date: await checkedDate(ctx, args.date),
      billable: args.billable ?? expense.billable,
      reimbursable: args.reimbursable ?? expense.reimbursable,
    });
  },
});

export const remove = teamMutation('expenses.log')({
  args: { expenseId: v.id('expenses') },
  handler: async (ctx, { expenseId }) => {
    const expense = await getExpense(ctx, expenseId);
    if (expense.loggedByMemberId !== ctx.principal.member._id || !EDITABLE.has(expense.status)) {
      throw expenseError('expenses.decided', 'Only your own expense, before it is decided, can be deleted');
    }
    await ctx.db.delete('expenses', expenseId);
  },
});

export const generateUploadUrl = teamMutation('expenses.log')({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** The receipt: the studio's own record, never shown to a client even when the expense is recharged. */
export const attachReceipt = teamMutation('expenses.log')({
  args: { expenseId: v.id('expenses'), storageId: v.id('_storage'), name: v.string(), contentType: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const expense = await getExpense(ctx, args.expenseId);
    if (expense.loggedByMemberId !== ctx.principal.member._id && !ctx.principal.permissions.has('expenses.approve')) {
      throw expenseError('expenses.notYours', 'You attach receipts to your own expenses');
    }
    const upload = await recordUpload(ctx, {
      storageId: args.storageId,
      name: args.name,
      contentType: args.contentType,
      context: 'document',
      owner: { table: 'expenses', id: expense._id },
      visibility: 'internal',
      clientId: expense.clientId,
      projectId: expense.projectId,
      uploadedBy: { kind: 'team', id: ctx.principal.member._id },
    });
    // Returned rather than thrown: throwing would roll back the upload record with it.
    if (!upload.ok) return { ok: false, message: upload.message };
    await ctx.db.patch('expenses', expense._id, { receiptFileId: upload.fileId });
    return { ok: true };
  },
});

/** Approving or turning one down. A note is required to turn one down, so the member knows why. */
export const decide = teamMutation('expenses.approve')({
  args: {
    expenseId: v.id('expenses'),
    decision: v.union(v.literal('approved'), v.literal('rejected')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { expenseId, decision, note }) => {
    const expense = await getExpense(ctx, expenseId);
    assertDecidable(expense);
    const reason = text(note, 'Note', { max: 500 });
    if (decision === 'rejected' && !reason) {
      throw expenseError('expenses.needsNote', 'Say why it is turned down');
    }
    await ctx.db.patch('expenses', expenseId, {
      status: decision,
      decisionNote: reason,
      approvedBy: ctx.principal.member._id,
      approvedAt: Date.now(),
    });
    await notifyTeamMembers(ctx, [expense.loggedByMemberId], {
      event: decision === 'approved' ? 'expense_approved' : 'expense_rejected',
      title: `Your ${formatMoney(expense.amountMinor, expense.currency)} expense was ${decision}`,
      body: reason ?? expense.description,
      link: `/expenses/${expenseId}`,
    });
  },
});

/** The studio has paid the member back. */
export const markReimbursed = teamMutation('expenses.approve')({
  args: { expenseId: v.id('expenses') },
  handler: async (ctx, { expenseId }) => {
    const expense = await getExpense(ctx, expenseId);
    if (!expense.reimbursable) throw expenseError('expenses.notReimbursable', 'This expense is not owed to anyone');
    if (expense.status !== 'approved') {
      throw expenseError('expenses.notApproved', 'Approve it before paying it back');
    }
    await ctx.db.patch('expenses', expenseId, { status: 'reimbursed', reimbursedAt: Date.now() });
  },
});

/**
 * Puts approved billable expenses on a draft invoice, at cost unless the studio has set a markup. The line says what
 * it was for; the receipt stays inside the studio.
 */
export const addToInvoice = teamMutation('invoices.update')({
  args: { invoiceId: v.id('invoices'), expenseIds: v.array(v.id('expenses')) },
  handler: async (ctx, { invoiceId, expenseIds }) => {
    const invoice = await ctx.db.get('invoices', invoiceId);
    if (!invoice) throw notFound('Invoice');
    const markupBps = (await getOrgSettings(ctx)).expenseMarkupBps ?? 0;

    const lines = [...invoice.lineItems];
    for (const expenseId of expenseIds) {
      const expense = await getExpense(ctx, expenseId);
      assertBillable(expense, invoice);
      const amountMinor = rechargeMinor(expense.amountMinor, markupBps);
      lines.push({
        description: `${CATEGORY_LABELS[expense.category as keyof typeof CATEGORY_LABELS] ?? expense.category}: ${expense.description} (${expense.date})`,
        quantityMilli: 1_000,
        unitPriceMinor: amountMinor,
        amountMinor,
        taxable: true,
      });
      await ctx.db.patch('expenses', expenseId, { status: 'invoiced', invoiceId });
    }

    const { lineItems, totals } = invoiceTotals(
      lines,
      invoice.discount as Parameters<typeof invoiceTotals>[1],
      invoice.vat,
      invoice.wht,
    );
    await ctx.db.patch('invoices', invoiceId, {
      lineItems,
      totals,
      balanceMinor: totals.totalMinor - invoice.paidMinor - invoice.whtCreditedMinor - invoice.creditedMinor,
    });
    await recordActivity(ctx, {
      subject: { table: 'clients', id: invoice.clientId },
      clientId: invoice.clientId,
      type: 'system',
      title: `${expenseIds.length} expense${expenseIds.length === 1 ? '' : 's'} added to ${invoice.number ?? 'a draft invoice'}`,
      actor: { kind: 'team', id: ctx.principal.member._id },
      meta: { invoiceId },
    });
    return { totalMinor: totals.totalMinor };
  },
});

/** Approved billable expenses on a client's projects that no invoice has taken yet. */
export const billableFor = teamQuery('invoices.update')({
  args: { clientId: v.id('clients'), currency: v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR')) },
  handler: async (ctx, { clientId, currency }) => {
    const markupBps = (await getOrgSettings(ctx)).expenseMarkupBps ?? 0;
    const rows = await ctx.db.query('expenses').take(1000);
    return rows
      .filter(
        (row) =>
          row.billable &&
          row.clientId === clientId &&
          row.currency === currency &&
          (row.status === 'approved' || row.status === 'reimbursed'),
      )
      .map((row) => ({
        ...expenseView(row),
        rechargeMinor: rechargeMinor(row.amountMinor, markupBps),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

/** For the project screen: what a project has cost, and how much of it is waiting to be billed. */
export const totalsForProject = internalQuery({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const rows = await ctx.db
      .query('expenses')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const counted = rows.filter((row) => row.status !== 'rejected');
    return {
      spentNgnMinor: counted.reduce(
        (sum, row) => sum + Math.round((row.amountMinor * row.fxRateToNgnMicro) / MICRO_PER_UNIT),
        0,
      ),
      awaitingInvoiceCount: counted.filter((row) => row.billable && row.status !== 'invoiced').length,
    };
  },
});

/** Everyone who can approve, for the reminder that expenses are waiting. */
export const approvers = internalQuery({
  args: {},
  handler: async (ctx) => await activeMembersWith(ctx, 'expenses.approve'),
});
