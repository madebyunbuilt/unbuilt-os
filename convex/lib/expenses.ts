import { ConvexError } from 'convex/values';
import { type Doc } from '../_generated/dataModel';
import { applyBps } from './money';

// Expense rules (08-billing-and-finance.md, Expenses). A member logs what they spent, an approver decides, and an
// approved billable expense joins an invoice **at cost** — the studio's markup is 0 unless it sets one
// (18-open-questions.md, studio 2026-09-23). Money is only ever read here, never invented.

export function expenseError(code: `expenses.${string}`, message: string) {
  return new ConvexError({ code, message });
}

/** The categories the studio spends under; free text would make the reports useless. */
export const EXPENSE_CATEGORIES = [
  'software',
  'hosting',
  'hardware',
  'travel',
  'meals',
  'subcontractor',
  'stock_assets',
  'office',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  software: 'Software',
  hosting: 'Hosting',
  hardware: 'Hardware',
  travel: 'Travel',
  meals: 'Meals',
  subcontractor: 'Subcontractor',
  stock_assets: 'Stock and assets',
  office: 'Office',
  other: 'Other',
};

/** Only a logged expense is still the member's to change; once decided it is the record of a decision. */
export const EDITABLE: ReadonlySet<Doc<'expenses'>['status']> = new Set(['logged']);

/** What a billable expense is recharged at: cost, plus the studio's markup when it has one. */
export function rechargeMinor(amountMinor: number, markupBps = 0): number {
  return markupBps > 0 ? amountMinor + applyBps(amountMinor, markupBps) : amountMinor;
}

export function assertDecidable(expense: Doc<'expenses'>) {
  if (expense.status !== 'logged') {
    throw expenseError('expenses.decided', `This expense has already been ${expense.status}`);
  }
}

/** An expense reaches an invoice once, approved, billable, and in the invoice's own currency. */
export function assertBillable(expense: Doc<'expenses'>, invoice: Doc<'invoices'>) {
  if (!expense.billable) throw expenseError('expenses.notBillable', 'This expense is not billable to a client');
  if (expense.status === 'invoiced') throw expenseError('expenses.invoiced', 'This expense is already on an invoice');
  if (expense.status !== 'approved' && expense.status !== 'reimbursed') {
    throw expenseError('expenses.notApproved', 'Only an approved expense goes on an invoice');
  }
  if (invoice.status !== 'draft') {
    throw expenseError('expenses.invoiceSent', 'That invoice has been sent, so nothing further can be added to it');
  }
  if (expense.currency !== invoice.currency) {
    throw expenseError(
      'expenses.currency',
      `This expense is in ${expense.currency} and that invoice is in ${invoice.currency}`,
    );
  }
  // No client at all is refused as firmly as the wrong one: an expense reaches a client through its project, and one
  // with no project belongs to nobody. Letting it through here would put a cost on a client who never incurred it.
  if (!expense.clientId) {
    throw expenseError('expenses.noClient', 'This expense has no project, so there is no client to bill it to');
  }
  if (expense.clientId !== invoice.clientId) {
    throw expenseError('expenses.otherClient', 'This expense belongs to another client');
  }
}

/** Billing a client for an expense means naming the project it was for; that is where its client comes from. */
export function assertBillableHasProject(args: { billable?: boolean; projectId?: unknown }) {
  if (args.billable && !args.projectId) {
    throw expenseError(
      'expenses.needsProject',
      'Choose the project this was for, so there is a client to bill it to — or untick billing it on',
    );
  }
}
