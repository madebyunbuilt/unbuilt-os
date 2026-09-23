'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import {
  ApproveExpenseButton,
  DecideExpenseDialog,
  DeleteExpenseButton,
  ExpenseFormDialog,
  ReceiptField,
  ReimburseButton,
} from '@/components/billing/expense-actions';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import { EXPENSE_STATUSES, type ExpenseStatus, expenseStatus } from '@/lib/expenses-display';

/** Expenses (08-billing-and-finance.md, Expenses): your own, or everybody's if you approve them. */
export function ExpenseList({ permissions, projectId }: { permissions: string[]; projectId?: Id<'projects'> }) {
  const canApprove = permissions.includes('expenses.approve');
  const canLog = permissions.includes('expenses.log');
  const [status, setStatus] = useState(canApprove ? 'logged' : 'all');
  const [mine, setMine] = useState(false);
  const expenses = useQuery(api.expenses.list, {
    projectId,
    status: status === 'all' ? undefined : status,
    mine: mine || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="expense-status-filter" className="text-xs text-muted-foreground">
            Show
          </Label>
          <NativeSelect id="expense-status-filter" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Everything</option>
            {EXPENSE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {expenseStatus(value).label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {canApprove && (
          <div className="space-y-1">
            <Label htmlFor="expense-mine-filter" className="text-xs text-muted-foreground">
              Whose
            </Label>
            <NativeSelect
              id="expense-mine-filter"
              value={mine ? 'mine' : 'all'}
              onChange={(event) => setMine(event.target.value === 'mine')}
            >
              <option value="all">Everyone</option>
              <option value="mine">Mine</option>
            </NativeSelect>
          </div>
        )}
        {canLog && (
          <div className="sm:ml-auto">
            <ExpenseFormDialog
              projectId={projectId}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  Log an expense
                </Button>
              }
            />
          </div>
        )}
      </div>

      {expenses === undefined ? (
        <p className="text-muted-foreground">Loading expenses…</p>
      ) : expenses.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          Nothing here. Expenses you log appear on this page.
        </p>
      ) : (
        <ul className="space-y-3">
          {expenses.map((expense) => {
            return (
              <li key={expense.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{expense.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {expense.categoryLabel} · {formatDay(expense.date)}
                      {expense.projectName ? ` · ${expense.projectName}` : ''}
                      {!expense.isMine && expense.loggedByName ? ` · ${expense.loggedByName}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">
                      {formatMoney(expense.amountMinor, expense.currency as Currency)}
                    </p>
                    <ToneBadge {...expenseStatus(expense.status as ExpenseStatus)} />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
                  {expense.billable && <span className="rounded-full border px-2 py-0.5">Billed to the client</span>}
                  {expense.reimbursable && (
                    <span className="rounded-full border px-2 py-0.5">
                      {expense.reimbursedAt ? 'Paid back' : 'Owed back'}
                    </span>
                  )}
                </div>

                {expense.decisionNote && (
                  <p className="mt-2 rounded-md border p-3 text-sm text-muted-foreground">{expense.decisionNote}</p>
                )}

                <div className="mt-3 border-t pt-3">
                  <ReceiptField expense={expense} />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {expense.isMine && expense.status === 'logged' && (
                    <>
                      <ExpenseFormDialog expense={expense} trigger={<Button variant="outline">Change it</Button>} />
                      <DeleteExpenseButton expense={expense} />
                    </>
                  )}
                  {canApprove && expense.status === 'logged' && (
                    <>
                      <ApproveExpenseButton expense={expense} />
                      <DecideExpenseDialog expense={expense} />
                    </>
                  )}
                  {canApprove && expense.status === 'approved' && expense.reimbursable && (
                    <ReimburseButton expense={expense} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
