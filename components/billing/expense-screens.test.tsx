import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseList } from './expense-list';

// The expenses screen (08-billing-and-finance.md, Expenses): a member sees and changes their own, an approver decides,
// and what goes to the server is what the person typed.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => {
    if (args === 'skip') return undefined;
    state.queryArgs[ref._name] = args;
    return state.queries[ref._name];
  },
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue({ ok: true });
    return state.mutations[ref._name];
  },
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(['expenses', 'projects', 'files'].map((name) => [name, functions(name)])),
  };
});

const MEMBER = ['expenses.log'];
const FINANCE = ['expenses.approve'];

const expense = (overrides: object = {}) => ({
  id: 'e1',
  projectId: 'p1',
  projectName: 'Glossup app',
  clientId: 'c1',
  category: 'stock_assets',
  categoryLabel: 'Stock and assets',
  description: 'Licence for three hero images',
  amountMinor: 25_000_00,
  currency: 'NGN',
  date: '2026-09-22',
  receiptFileId: undefined,
  billable: true,
  reimbursable: false,
  reimbursedAt: undefined,
  status: 'logged',
  decisionNote: undefined,
  loggedByMemberId: 'm1',
  loggedByName: 'Dayo Ade',
  isMine: true,
  invoiceId: undefined,
  createdAt: 1,
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'expenses.list': [expense()],
    'projects.list': [{ id: 'p1', code: 'UNB-P-0001', name: 'Glossup app' }],
  };
  state.queryArgs = {};
  state.mutations = {};
});

describe('the expenses screen', () => {
  it('logs what was spent, with the project and the flags', async () => {
    render(<ExpenseList permissions={MEMBER} />);
    await userEvent.click(screen.getByRole('button', { name: 'Log an expense' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log an expense' });

    await userEvent.type(within(dialog).getByLabelText('What it was'), 'Taxi to the shoot');
    await userEvent.type(within(dialog).getByLabelText('Amount'), '8000');
    await userEvent.selectOptions(within(dialog).getByLabelText('What kind'), 'travel');
    await userEvent.selectOptions(within(dialog).getByLabelText('Project (optional)'), 'p1');
    await userEvent.click(within(dialog).getByLabelText('Bill this to the client'));
    await userEvent.click(within(dialog).getByLabelText('The studio owes me this back'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log it' }));

    await waitFor(() =>
      expect(state.mutations['expenses.log']).toHaveBeenCalledWith({
        category: 'travel',
        description: 'Taxi to the shoot',
        amountMinor: 800_000,
        currency: 'NGN',
        date: expect.any(String),
        projectId: 'p1',
        billable: true,
        reimbursable: true,
      }),
    );
  });

  it('lets the person who logged it change or delete it while it is still waiting', async () => {
    render(<ExpenseList permissions={MEMBER} />);
    expect(screen.getByRole('button', { name: 'Change it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    // No approving from the person who spent it.
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('stops offering that once it has been decided', async () => {
    state.queries['expenses.list'] = [expense({ status: 'approved' })];
    render(<ExpenseList permissions={MEMBER} />);
    expect(screen.queryByRole('button', { name: 'Change it' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('offers an approver the decision, and sends the reason with a refusal', async () => {
    state.queries['expenses.list'] = [expense({ isMine: false })];
    render(<ExpenseList permissions={FINANCE} />);
    expect(screen.getByText('Dayo Ade', { exact: false })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Turn it down' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn this expense down' });
    // Nothing is sent without a reason.
    expect(within(dialog).getByRole('button', { name: 'Turn it down' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Why'), 'Buy this through the studio account');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn it down' }));

    await waitFor(() =>
      expect(state.mutations['expenses.decide']).toHaveBeenCalledWith({
        expenseId: 'e1',
        decision: 'rejected',
        note: 'Buy this through the studio account',
      }),
    );
  });

  it('does not offer paying back an expense nobody is owed', async () => {
    state.queries['expenses.list'] = [expense({ isMine: false, status: 'approved', reimbursable: false })];
    render(<ExpenseList permissions={FINANCE} />);
    expect(screen.queryByRole('button', { name: 'Mark paid back' })).not.toBeInTheDocument();
  });

  it('offers paying back an approved expense that is owed', async () => {
    state.queries['expenses.list'] = [expense({ isMine: false, status: 'approved', reimbursable: true })];
    render(<ExpenseList permissions={FINANCE} />);
    expect(screen.getByRole('button', { name: 'Mark paid back' })).toBeInTheDocument();
  });

  it('asks the server for what is waiting when an approver opens it', async () => {
    render(<ExpenseList permissions={FINANCE} />);
    await waitFor(() => expect(state.queryArgs['expenses.list']).toMatchObject({ status: 'logged' }));
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'all');
    await waitFor(() => expect(state.queryArgs['expenses.list']).toMatchObject({ status: undefined }));
    await userEvent.selectOptions(screen.getByLabelText('Whose'), 'mine');
    await waitFor(() => expect(state.queryArgs['expenses.list']).toMatchObject({ mine: true }));
  });

  it('says what a turned-down expense was turned down for', async () => {
    state.queries['expenses.list'] = [
      expense({ status: 'rejected', decisionNote: 'Buy this through the studio account' }),
    ];
    render(<ExpenseList permissions={MEMBER} />);
    expect(screen.getByText('Buy this through the studio account')).toBeInTheDocument();
    // The list, not the filter that also offers "Turned down".
    expect(within(screen.getByRole('listitem')).getByText('Turned down')).toBeInTheDocument();
  });
});
