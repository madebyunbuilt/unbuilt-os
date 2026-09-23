import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { ExpenseList } from '@/components/billing/expense-list';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Expenses' };

export default async function ExpensesPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['expenses.log', 'expenses.approve']} what="expenses">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <h1 className="mb-2 font-display text-3xl font-bold">Expenses</h1>
        <p className="mb-6 text-muted-foreground">
          What the studio spent. An approved billable expense can be added to a draft invoice at cost.
        </p>
        <ExpenseList permissions={permissions} />
      </div>
    </RequirePermission>
  );
}
