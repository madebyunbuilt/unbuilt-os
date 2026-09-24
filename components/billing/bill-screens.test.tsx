import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillList } from './bill-list';
import { VendorList } from './vendor-list';

// The bills and vendors screens (08-billing-and-finance.md, Vendors and bills): what each role is offered, and the
// withholding shown before anyone commits to paying.

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
  return { api: Object.fromEntries(['bills', 'vendors', 'projects'].map((name) => [name, functions(name)])) };
});

const KEEPER = ['bills.manage'];
const PAYER = ['bills.pay'];

const vendor = (overrides: object = {}) => ({
  id: 'v1',
  name: 'Chidi Animation',
  kind: 'contractor',
  memberId: undefined,
  email: 'chidi@example.com',
  phone: undefined,
  tin: '12345678-0001',
  whtBps: 500,
  notes: undefined,
  status: 'active',
  bankDetails: { bankName: 'GTBank', accountName: 'Chidi Animation Ltd', accountNumber: '0123456789' },
  hasBankDetails: true,
  ...overrides,
});

// ₦1,075,000 with ₦75,000 VAT: 5% of the ₦1,000,000 before VAT is withheld.
const bill = (overrides: object = {}) => ({
  id: 'b1',
  vendorId: 'v1',
  vendorName: 'Chidi Animation',
  projectId: undefined,
  reference: 'CA-2026-14',
  description: 'Title sequence animation',
  amountMinor: 1_075_000_00,
  vatMinor: 75_000_00,
  currency: 'NGN',
  issueDate: '2026-09-01',
  dueDate: '2026-09-30',
  status: 'draft',
  scheduledFor: undefined,
  fileId: undefined,
  whtMinor: 50_000_00,
  payableMinor: 1_025_000_00,
  paidOn: undefined,
  paymentReference: undefined,
  voidReason: undefined,
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'bills.list': [bill()],
    'vendors.list': [vendor()],
    'projects.list': [{ id: 'p1', code: 'UNB-P-0001', name: 'Glossup app' }],
  };
  state.queryArgs = {};
  state.mutations = {};
});

describe('the bills screen', () => {
  it('records a bill with its VAT kept separate', async () => {
    render(<BillList permissions={KEEPER} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a bill' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a bill' });

    await userEvent.selectOptions(within(dialog).getByLabelText('Who it is from'), 'v1');
    await userEvent.type(within(dialog).getByLabelText('Their invoice number'), 'CA-2026-20');
    await userEvent.type(within(dialog).getByLabelText('What it is for'), 'Storyboards');
    await userEvent.type(within(dialog).getByLabelText('Total'), '215000');
    await userEvent.type(within(dialog).getByLabelText('Of which VAT'), '15000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(state.mutations['bills.create']).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: 'v1',
          reference: 'CA-2026-20',
          amountMinor: 21_500_000,
          vatMinor: 1_500_000,
          currency: 'NGN',
        }),
      ),
    );
  });

  it('shows what will be withheld and what the vendor receives, before it is paid', async () => {
    state.queries['bills.list'] = [bill({ status: 'approved' })];
    render(<BillList permissions={PAYER} />);
    expect(screen.getByText(/Withholding ₦50,000\.00/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pay Chidi Animation' });
    expect(within(dialog).getByText('₦1,075,000.00')).toBeInTheDocument();
    expect(within(dialog).getByText('₦50,000.00')).toBeInTheDocument();
    expect(within(dialog).getByText('₦1,025,000.00')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Reference'), 'GTB/TRF/88213');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record it' }));
    await waitFor(() =>
      expect(state.mutations['bills.pay']).toHaveBeenCalledWith({
        billId: 'b1',
        paidOn: expect.any(String),
        paymentReference: 'GTB/TRF/88213',
      }),
    );
  });

  it('offers approving and deleting only while it is a draft', async () => {
    render(<BillList permissions={KEEPER} />);
    expect(screen.getByRole('button', { name: 'Approve it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    // Paying belongs to a different permission.
    expect(screen.queryByRole('button', { name: 'Record the payment' })).not.toBeInTheDocument();
  });

  it('stops offering anything once the bill is paid', async () => {
    state.queries['bills.list'] = [bill({ status: 'paid', paidOn: '2026-09-23' })];
    render(<BillList permissions={[...KEEPER, ...PAYER]} />);
    expect(screen.queryByRole('button', { name: 'Record the payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    expect(screen.getByText(/Withheld ₦50,000\.00/)).toBeInTheDocument();
  });

  it('says why a bill was voided', async () => {
    state.queries['bills.list'] = [bill({ status: 'void', voidReason: 'Sent to the wrong studio' })];
    render(<BillList permissions={KEEPER} />);
    expect(screen.getByText('Sent to the wrong studio')).toBeInTheDocument();
  });
});

describe('the vendors screen', () => {
  it('adds a vendor with the rate to withhold and where the money goes', async () => {
    render(<VendorList />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a vendor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a vendor' });

    await userEvent.type(within(dialog).getByLabelText('Name'), 'Paper Co');
    await userEvent.selectOptions(within(dialog).getByLabelText('What they are'), 'supplier');
    await userEvent.type(within(dialog).getByLabelText('Withholding rate (%)'), '5');
    await userEvent.type(within(dialog).getByLabelText('Bank'), 'GTBank');
    await userEvent.type(within(dialog).getByLabelText('Account name'), 'Paper Co Ltd');
    await userEvent.type(within(dialog).getByLabelText('Account number'), '0987654321');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(state.mutations['vendors.create']).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Paper Co',
          kind: 'supplier',
          whtBps: 500,
          bankDetails: { bankName: 'GTBank', accountName: 'Paper Co Ltd', accountNumber: '0987654321' },
        }),
      ),
    );
  });

  it('shows the bank details to a role that may read them', async () => {
    render(<VendorList />);
    expect(screen.getByText(/0123456789/)).toBeInTheDocument();
    expect(screen.getByText('Withhold 5%')).toBeInTheDocument();
  });

  it('says the details exist without showing them when the server withheld them', async () => {
    state.queries['vendors.list'] = [vendor({ bankDetails: undefined, hasBankDetails: true })];
    render(<VendorList />);
    expect(screen.getByText('Bank details on file, which your role does not open.')).toBeInTheDocument();
    expect(screen.queryByText(/0123456789/)).not.toBeInTheDocument();
  });

  it('archives a vendor rather than deleting them', async () => {
    render(<VendorList />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive Chidi Animation' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(state.mutations['vendors.setStatus']).toHaveBeenCalledWith({ vendorId: 'v1', status: 'archived' }),
    );
  });
});
