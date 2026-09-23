'use client';

import { useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { uploadToStorage } from '@/components/app/image-upload-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { toAmountInput } from '@/lib/crm-display';
import { EXPENSE_CATEGORY_OPTIONS } from '@/lib/expenses-display';
import { lagosToday } from '@/lib/invoices-display';

// What can be done to an expense (08-billing-and-finance.md, Expenses). A member logs and changes their own; an
// approver decides and pays it back. The server checks each permission again.

type Expense = (typeof api.expenses.list._returnType)[number];

/** Logging what you spent, or changing it while it is still yours to change. */
export function ExpenseFormDialog({
  expense,
  projectId,
  trigger,
}: {
  expense?: Expense;
  projectId?: Id<'projects'>;
  trigger: ReactNode;
}) {
  const log = useMutation(api.expenses.log);
  const update = useMutation(api.expenses.update);
  const projects = useQuery(api.projects.list, {});
  const [category, setCategory] = useState(expense?.category ?? 'software');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? toAmountInput(expense.amountMinor) : '');
  const [currency, setCurrency] = useState<Currency>((expense?.currency as Currency) ?? 'NGN');
  const [date, setDate] = useState(expense?.date ?? lagosToday());
  const [project, setProject] = useState(expense?.projectId ?? projectId ?? '');
  const [billable, setBillable] = useState(expense?.billable ?? false);
  const [reimbursable, setReimbursable] = useState(expense?.reimbursable ?? false);

  return (
    <FormDialog
      trigger={trigger}
      title={expense ? 'Change this expense' : 'Log an expense'}
      description={
        expense
          ? 'You can change it until somebody approves it.'
          : 'What you spent, and whether the client is billed for it. Attach the receipt once it is logged.'
      }
      submitLabel={expense ? 'Save' : 'Log it'}
      canSubmit={description.trim().length > 0 && amount.trim().length > 0}
      onSubmit={async () => {
        const shared = {
          category: category as 'software',
          description,
          amountMinor: parseMoneyInput(amount, (expense?.currency as Currency) ?? currency),
          date,
          projectId: project ? (project as Id<'projects'>) : undefined,
          billable,
          reimbursable,
        };
        if (expense) await update({ expenseId: expense.id, ...shared });
        else await log({ ...shared, currency });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="expense-category">What kind</Label>
          <NativeSelect id="expense-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {EXPENSE_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="expense-date">When</Label>
          <Input id="expense-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="expense-description">What it was</Label>
        <Textarea
          id="expense-description"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="expense-amount">Amount</Label>
          <Input
            id="expense-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        {!expense && (
          <div className="space-y-2">
            <Label htmlFor="expense-currency">Currency</Label>
            <NativeSelect
              id="expense-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              <option value="NGN">NGN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </NativeSelect>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="expense-project">Project (optional)</Label>
        <NativeSelect id="expense-project" value={project} onChange={(event) => setProject(event.target.value)}>
          <option value="">No project</option>
          {(projects ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.code} · {row.name}
            </option>
          ))}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          A project puts it against that client, which is what lets it be billed on.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox id="expense-billable" checked={billable} onCheckedChange={(value) => setBillable(value === true)} />
          <Label htmlFor="expense-billable" className="font-normal">
            Bill this to the client
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="expense-reimbursable"
            checked={reimbursable}
            onCheckedChange={(value) => setReimbursable(value === true)}
          />
          <Label htmlFor="expense-reimbursable" className="font-normal">
            The studio owes me this back
          </Label>
        </div>
      </div>
    </FormDialog>
  );
}

/** Approving, or turning one down with a reason the member will read. */
export function DecideExpenseDialog({ expense }: { expense: Expense }) {
  const decide = useMutation(api.expenses.decide);
  const [note, setNote] = useState('');
  return (
    <FormDialog
      trigger={<Button variant="outline">Turn it down</Button>}
      title="Turn this expense down"
      description={`${formatMoney(expense.amountMinor, expense.currency as Currency)} — ${expense.description}`}
      submitLabel="Turn it down"
      canSubmit={note.trim().length > 0}
      onSubmit={() => decide({ expenseId: expense.id, decision: 'rejected', note })}
    >
      <div className="space-y-2">
        <Label htmlFor="expense-note">Why</Label>
        <Textarea id="expense-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        <p className="text-sm text-muted-foreground">{expense.loggedByName ?? 'Whoever logged it'} will see this.</p>
      </div>
    </FormDialog>
  );
}

export function ApproveExpenseButton({ expense }: { expense: Expense }) {
  const decide = useMutation(api.expenses.decide);
  return (
    <ConfirmDialog
      trigger={<Button>Approve</Button>}
      title="Approve this expense"
      description={`${formatMoney(expense.amountMinor, expense.currency as Currency)} — ${expense.description}`}
      confirmLabel="Approve"
      onConfirm={() => decide({ expenseId: expense.id, decision: 'approved' })}
    />
  );
}

export function ReimburseButton({ expense }: { expense: Expense }) {
  const markReimbursed = useMutation(api.expenses.markReimbursed);
  return (
    <ConfirmDialog
      trigger={<Button variant="outline">Mark paid back</Button>}
      title="Paid back"
      description={`Says the studio has paid ${expense.loggedByName ?? 'them'} the ${formatMoney(expense.amountMinor, expense.currency as Currency)} back. It can still be billed to the client.`}
      confirmLabel="Mark paid back"
      onConfirm={() => markReimbursed({ expenseId: expense.id })}
    />
  );
}

export function DeleteExpenseButton({ expense }: { expense: Expense }) {
  const remove = useMutation(api.expenses.remove);
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" className="text-destructive">
          Delete
        </Button>
      }
      title="Delete this expense"
      description="It has not been decided yet, so nothing is kept."
      confirmLabel="Delete"
      onConfirm={() => remove({ expenseId: expense.id })}
    />
  );
}

/** The receipt, kept inside the studio: a client never sees it, even when the expense is billed on. */
export function ReceiptField({ expense }: { expense: Expense }) {
  const generateUploadUrl = useMutation(api.expenses.generateUploadUrl);
  const attach = useMutation(api.expenses.attachReceipt);
  const stored = useQuery(
    api.files.teamDownloadUrl,
    expense.receiptFileId ? { fileId: expense.receiptFileId } : 'skip',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {expense.receiptFileId && stored ? (
        <a href={stored.url} className="text-sm underline" target="_blank" rel="noreferrer">
          Open the receipt
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">No receipt yet.</p>
      )}
      <div>
        <Label htmlFor={`receipt-${expense.id}`} className="sr-only">
          Attach a receipt
        </Label>
        <Input
          id={`receipt-${expense.id}`}
          type="file"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              const storageId = await uploadToStorage(await generateUploadUrl({}), file);
              const result = await attach({
                expenseId: expense.id,
                storageId: storageId as Id<'_storage'>,
                name: file.name,
                contentType: file.type,
              });
              if (!result.ok) setError(result.message);
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setBusy(false);
              event.target.value = '';
            }
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
