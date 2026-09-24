import { CATEGORY_LABELS, EXPENSE_CATEGORIES } from '@/convex/lib/expenses';
import { type StatusTone } from '@/lib/team-display';

// How expenses are shown (08-billing-and-finance.md, Expenses), in the words the studio would use.

export const EXPENSE_CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export type ExpenseStatus = 'logged' | 'approved' | 'rejected' | 'reimbursed' | 'invoiced';

export const EXPENSE_STATUSES: ExpenseStatus[] = ['logged', 'approved', 'rejected', 'reimbursed', 'invoiced'];

export function expenseStatus(status: ExpenseStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'logged':
      return { label: 'Waiting', tone: 'draft' };
    case 'approved':
      return { label: 'Approved', tone: 'built' };
    case 'rejected':
      return { label: 'Turned down', tone: 'muted' };
    case 'reimbursed':
      return { label: 'Paid back', tone: 'built' };
    case 'invoiced':
      return { label: 'Billed on', tone: 'built' };
  }
}
