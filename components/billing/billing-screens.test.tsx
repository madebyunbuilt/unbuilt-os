import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientBilling } from './client-billing';
import { InvoiceList } from './invoice-list';
import { InvoicePage } from './invoice-page';
import { FxRates } from '@/components/settings/fx-rates';

// The billing screens (08-billing-and-finance.md): each action shows only where the invoice's state and the viewer's
// permissions allow it, and sends the server what the person entered.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  push: vi.fn(),
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/billing/invoices',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(
      [
        'invoices',
        'payments',
        'credits',
        'statements',
        'billingChase',
        'fx',
        'clients',
        'contacts',
        'projects',
        'rateCard',
        'files',
        'expenses',
      ].map((name) => [name, functions(name)]),
    ),
  };
});

const FINANCE = [
  'clients.view',
  'invoices.view',
  'invoices.create',
  'invoices.update',
  'invoices.send',
  'invoices.void',
  'invoices.writeoff',
  'payments.record',
  'payments.refund',
  'creditnotes.create',
  'fx.manage',
];
const READER = ['invoices.view'];

const totals = {
  subtotalMinor: 10_000_000,
  discountMinor: 0,
  taxableMinor: 10_000_000,
  vatMinor: 0,
  totalMinor: 10_000_000,
  whtExpectedMinor: 500_000,
};

const invoice = (overrides: object = {}) => ({
  id: 'i1',
  number: 'UNB-INV-0010',
  type: 'standard',
  typeLabel: 'Invoice',
  status: 'partially_paid',
  clientId: 'c1',
  clientName: 'Glossup',
  currency: 'NGN',
  fxRateToNgnMicro: 1_000_000,
  issueDate: '2026-09-01',
  dueDate: '2026-10-01',
  paymentTermsDays: 30,
  totals,
  paidMinor: 6_000_000,
  whtCreditedMinor: 0,
  creditedMinor: 0,
  balanceMinor: 4_000_000,
  createdAt: 1,
  lineItems: [
    {
      description: 'Website design',
      quantityMilli: 1_000,
      unitPriceMinor: 10_000_000,
      amountMinor: 10_000_000,
      taxable: true,
    },
  ],
  discount: { kind: 'none' },
  vat: { applies: false, bps: 750 },
  vatTreatment: 'exempt',
  wht: { applies: true, bps: 500 },
  fxRateOverridden: false,
  pdfFileId: 'f1',
  noReminders: false,
  createdByName: 'Kemi Bello',
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'invoices.list': [invoice()],
    'invoices.get': invoice(),
    'payments.forInvoice': {
      payments: [
        {
          id: 'p1',
          amountMinor: 6_000_000,
          refundedMinor: 0,
          currency: 'NGN',
          method: 'bank_transfer',
          status: 'succeeded',
          receivedOn: '2026-09-10',
          reference: 'GTB-1',
          instrument: undefined,
          receipt: { id: 'r1', number: 'UNB-RCT-0001', pdfFileId: 'rf1', sentAt: 1 },
          wht: [],
        },
      ],
      whtCredits: [],
      refunds: [],
    },
    'credits.forInvoice': { creditNotes: [], appliedCredit: [] },
    'credits.forClient': [],
    'contacts.listForClient': [
      { id: 'ct1', name: 'Ada Obi', email: 'ada@glossup.com', isPrimary: true, isBilling: false, status: 'active' },
      {
        id: 'ct2',
        name: 'Accounts',
        email: 'accounts@glossup.com',
        isPrimary: false,
        isBilling: true,
        status: 'active',
      },
    ],
  };
  state.queryArgs = {};
  state.mutations = {};
  state.push.mockClear();
});

describe('InvoiceList', () => {
  it('shows what is waiting for money by default, with what is still owed', () => {
    render(<InvoiceList permissions={FINANCE} />);
    expect(state.queryArgs['invoices.list']).toEqual({ clientId: undefined, status: 'open' });
    const row = screen.getByRole('link', { name: /UNB-INV-0010/ }).closest('tr')!;
    expect(row).toHaveTextContent('Glossup');
    expect(row).toHaveTextContent('Partly paid');
    expect(row).toHaveTextContent('₦40,000.00');
    expect(screen.getByRole('button', { name: 'New invoice' })).toBeInTheDocument();
  });

  it('offers nothing to create without invoices.create', () => {
    render(<InvoiceList permissions={READER} />);
    expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument();
  });
});

describe('InvoicePage', () => {
  it('shows the balance and records a payment, starting from what is still owed', async () => {
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.getByRole('heading', { level: 1, name: 'UNB-INV-0010' })).toBeInTheDocument();
    expect(screen.getByText('Still owed').nextSibling).toHaveTextContent('₦40,000.00');
    expect(screen.getByText(/receipt UNB-RCT-0001 emailed/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    expect(within(dialog).getByLabelText('Amount received (NGN)')).toHaveValue('40000');
    await userEvent.type(within(dialog).getByLabelText('Reference (optional)'), 'GTB-2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record it' }));
    await waitFor(() =>
      expect(state.mutations['payments.record']).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'i1',
          amountMinor: 4_000_000,
          whtDeductedMinor: 0,
          reference: 'GTB-2',
          emailReceipt: true,
        }),
      ),
    );
  });

  it('starts a first payment at the total less the WHT the client will deduct', async () => {
    state.queries['invoices.get'] = invoice({ status: 'sent', paidMinor: 0, balanceMinor: 10_000_000 });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    expect(within(dialog).getByLabelText('Amount received (NGN)')).toHaveValue('95000');
    expect(within(dialog).getByLabelText('WHT the client withheld (NGN)')).toHaveValue('5000');
  });

  it('hides the WHT box for a client who does not deduct it, one click away', async () => {
    state.queries['invoices.get'] = invoice({ wht: { applies: false, bps: 0 } });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    expect(within(dialog).queryByLabelText('WHT the client withheld (NGN)')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'The client withheld tax' }));
    expect(within(dialog).getByLabelText('WHT the client withheld (NGN)')).toHaveValue('');
  });

  it('works the WHT out from the amount until a figure is typed into it', async () => {
    state.queries['invoices.get'] = invoice({
      status: 'sent',
      totals: { ...totals, totalMinor: 21_500_000, vatMinor: 1_500_000, whtExpectedMinor: 600_000 },
      paidMinor: 0,
      creditedMinor: 11_600_000,
      balanceMinor: 9_900_000,
    });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    const amount = within(dialog).getByLabelText('Amount received (NGN)');
    const wht = within(dialog).getByLabelText('WHT the client withheld (NGN)');
    expect(amount).toHaveValue('96237.21');
    expect(wht).toHaveValue('2762.79');
    await userEvent.clear(amount);
    await userEvent.type(amount, '10000');
    expect(wht).toHaveValue('287.08');
    await userEvent.clear(wht);
    await userEvent.type(wht, '300');
    await userEvent.clear(amount);
    await userEvent.type(amount, '20000');
    expect(wht).toHaveValue('300');
  });

  it('issues a credit note and says what will be held when it exceeds the balance', async () => {
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Issue a credit note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Issue a credit note' });
    await userEvent.type(within(dialog).getByLabelText('Amount to credit, including VAT (NGN)'), '50000');
    expect(dialog).toHaveTextContent('₦40,000.00 clears what is owed; ₦10,000.00 is held as the client’s credit.');
    await userEvent.type(within(dialog).getByLabelText('Why'), '5 days not delivered');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue it' }));
    await waitFor(() =>
      expect(state.mutations['credits.create']).toHaveBeenCalledWith({
        invoiceId: 'i1',
        reason: '5 days not delivered',
        amountMinor: 5_000_000,
        emailCreditNote: true,
      }),
    );
  });

  it('refuses to credit more than the invoice, before splitting anything into held credit', async () => {
    state.queries['invoices.get'] = invoice({ status: 'sent', paidMinor: 0, balanceMinor: 10_000_000 });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Issue a credit note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Issue a credit note' });
    await userEvent.type(within(dialog).getByLabelText('Amount to credit, including VAT (NGN)'), '200000');
    await userEvent.type(within(dialog).getByLabelText('Why'), 'x');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('At most ₦100,000.00 can be credited on this invoice.');
    expect(dialog).not.toHaveTextContent('held as the client’s credit');
    expect(within(dialog).getByRole('button', { name: 'Issue it' })).toBeDisabled();
  });

  it('takes payment terms as a number of days, and labels VAT and WHT as rates', async () => {
    state.queries['invoices.get'] = invoice({
      status: 'draft',
      number: undefined,
      issueDate: undefined,
      dueDate: undefined,
      paidMinor: 0,
      balanceMinor: 10_000_000,
    });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit the draft' }));
    const dialog = await screen.findByRole('dialog');
    const terms = within(dialog).getByLabelText('Payment terms');
    await userEvent.clear(terms);
    await userEvent.type(terms, '6 days');
    expect(terms).toHaveValue(6);
    expect(within(dialog).getByLabelText('WHT rate')).toHaveValue('5');
    await userEvent.type(within(dialog).getByLabelText('WHT rate'), '%');
    expect(within(dialog).getByLabelText('WHT rate')).toHaveValue('5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the draft' }));
    await waitFor(() =>
      expect(state.mutations['invoices.update']).toHaveBeenCalledWith(
        expect.objectContaining({ paymentTermsDays: 6, wht: { applies: true, bps: 500 } }),
      ),
    );
  });

  it('bases the WHT on what is still owed once part is credited, and names a credit-only settlement', async () => {
    state.queries['invoices.get'] = invoice({
      status: 'sent',
      totals: { ...totals, totalMinor: 21_500_000, vatMinor: 1_500_000, whtExpectedMinor: 600_000 },
      paidMinor: 0,
      creditedMinor: 11_500_000,
      balanceMinor: 10_000_000,
    });
    const { unmount } = render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.getByText('WHT on what is still owed').nextSibling).toHaveTextContent('₦2,790.70');
    await userEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    expect(within(dialog).getByLabelText('Amount received (NGN)')).toHaveValue('97209.30');
    expect(within(dialog).getByLabelText('WHT the client withheld (NGN)')).toHaveValue('2790.70');
    unmount();

    state.queries['invoices.get'] = invoice({
      status: 'paid',
      paidMinor: 0,
      creditedMinor: 10_000_000,
      balanceMinor: 0,
    });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.getByText('Credited in full')).toBeInTheDocument();
  });

  it('says how a card payment arrived', () => {
    state.queries['payments.forInvoice'] = {
      payments: [
        {
          id: 'p1',
          amountMinor: 140_000,
          refundedMinor: 0,
          currency: 'NGN',
          method: 'paystack',
          instrument: 'Card · visa ending 4081',
          status: 'succeeded',
          receivedOn: '2026-09-23',
          receipt: null,
          wht: [],
        },
      ],
      whtCredits: [],
      refunds: [],
    };
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.getByText(/Card · visa ending 4081/)).toBeInTheDocument();
  });

  it('shows a zero VAT line with the reason, and warns when VAT is on but no line carries it', async () => {
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.getByText('VAT (exempt)').nextSibling).toHaveTextContent('₦0.00');

    state.queries['invoices.get'] = invoice({
      status: 'draft',
      number: undefined,
      vat: { applies: true, bps: 750 },
      vatTreatment: 'standard',
      totals: { ...totals, taxableMinor: 0, vatMinor: 0 },
      lineItems: [
        {
          description: 'Website design',
          quantityMilli: 1_000,
          unitPriceMinor: 10_000_000,
          amountMinor: 10_000_000,
          taxable: false,
        },
      ],
    });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.getAllByText(/No line carries VAT, so this invoice charges none/)[0]).toBeInTheDocument();
  });

  it('does not offer void once money is on it, but offers the write-off', () => {
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write off' })).toBeInTheDocument();
  });

  it('sends a draft to the billing contacts by default', async () => {
    state.queries['invoices.get'] = invoice({
      status: 'draft',
      number: undefined,
      issueDate: undefined,
      dueDate: undefined,
      paidMinor: 0,
      balanceMinor: 10_000_000,
      pdfFileId: undefined,
    });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.queryByRole('button', { name: 'Record a payment' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send the invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send the invoice' });
    expect(within(dialog).getByLabelText(/Accounts/)).toBeChecked();
    expect(within(dialog).getByLabelText(/Ada Obi/)).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(state.mutations['invoices.send']).toHaveBeenCalledWith({
        invoiceId: 'i1',
        contactIds: undefined,
        message: undefined,
      }),
    );
    expect(screen.getByRole('button', { name: 'Delete the draft' })).toBeInTheDocument();
    // Nothing to send again until it has been sent once.
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();
  });

  it('adds approved expenses to a draft at what the studio paid', async () => {
    state.queries['invoices.get'] = invoice({
      status: 'draft',
      number: undefined,
      issueDate: undefined,
      dueDate: undefined,
      paidMinor: 0,
      balanceMinor: 10_000_000,
      pdfFileId: undefined,
    });
    state.queries['expenses.billableFor'] = [
      {
        id: 'e1',
        description: 'Licence for three hero images',
        categoryLabel: 'Stock and assets',
        date: '2026-09-22',
        amountMinor: 25_000_00,
        rechargeMinor: 25_000_00,
      },
    ];
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add expenses' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add expenses to this invoice' });
    // Nothing is added until something is ticked.
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled();
    await userEvent.click(within(dialog).getByLabelText(/Licence for three hero images/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add ₦25,000.00' }));
    await waitFor(() =>
      expect(state.mutations['expenses.addToInvoice']).toHaveBeenCalledWith({
        invoiceId: 'i1',
        expenseIds: ['e1'],
      }),
    );
  });

  it('offers nothing to add when no expense is waiting', () => {
    state.queries['invoices.get'] = invoice({ status: 'draft', number: undefined, pdfFileId: undefined });
    state.queries['expenses.billableFor'] = [];
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    expect(screen.queryByRole('button', { name: 'Add expenses' })).not.toBeInTheDocument();
  });

  it('sends a sent invoice again, to whoever had it last', async () => {
    state.queries['invoices.get'] = invoice({
      status: 'sent',
      paidMinor: 0,
      balanceMinor: 10_000_000,
      recipientContactIds: ['ct1'],
    });
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send this invoice again' });
    expect(within(dialog).getByLabelText(/Ada Obi/)).toBeChecked();
    expect(within(dialog).getByLabelText(/Accounts/)).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send again' }));
    await waitFor(() =>
      expect(state.mutations['invoices.sendAgain']).toHaveBeenCalledWith({
        invoiceId: 'i1',
        contactIds: undefined,
        message: undefined,
      }),
    );
  });

  it('offers held credit in the same currency', async () => {
    state.queries['credits.forClient'] = [
      {
        id: 'cc1',
        currency: 'NGN',
        amountMinor: 1_000_000,
        remainingMinor: 1_000_000,
        creditNoteNumber: 'UNB-CN-0001',
      },
      { id: 'cc2', currency: 'USD', amountMinor: 5_000, remainingMinor: 5_000 },
    ];
    render(<InvoicePage invoiceId={'i1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Apply held credit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply held credit' });
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply it' }));
    await waitFor(() =>
      expect(state.mutations['credits.apply']).toHaveBeenCalledWith({
        clientCreditId: 'cc1',
        invoiceId: 'i1',
        amountMinor: 1_000_000,
      }),
    );
  });

  it('gives a reader the invoice and its PDF, and nothing to change', () => {
    render(<InvoicePage invoiceId={'i1' as never} permissions={READER} />);
    expect(screen.getByRole('button', { name: /Download the PDF/ })).toBeInTheDocument();
    for (const name of ['Record a payment', 'Issue a credit note', 'Write off', 'Refund']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Send payment reminders')).not.toBeInTheDocument();
  });
});

describe('InvoiceFormDialog', () => {
  it('shows what the client is charged before the invoice is created', async () => {
    state.queries['clients.list'] = [{ id: 'c1', displayName: 'Glossup', defaultCurrency: 'NGN' }];
    state.queries['invoices.defaultsFor'] = {
      vat: { applies: true, bps: 750 },
      wht: { applies: true, bps: 500 },
      paymentTermsDays: 30,
      currency: 'NGN',
    };
    state.queries['rateCard.list'] = [];
    render(<InvoiceList permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'New invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'New invoice' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Client'), 'c1');
    expect(within(dialog).getByLabelText('Charge VAT')).toBeChecked();
    expect(within(dialog).getByLabelText('VAT rate')).toHaveValue('7.5');
    expect(within(dialog).getByLabelText('Client deducts WHT')).toBeChecked();
    expect(within(dialog).getByLabelText('WHT rate')).toHaveValue('5');
  });
});

describe('ClientBilling', () => {
  it('shows the statement for the range, with the balance in credit written out', () => {
    state.queries['statements.forClient'] = [
      {
        currency: 'NGN',
        openingMinor: 4_000_000,
        closingMinor: -1_000_000,
        lines: [
          {
            date: '2026-09-15',
            kind: 'credit_note',
            description: 'Credit note UNB-CN-0001 against UNB-INV-0010',
            debitMinor: 0,
            creditMinor: 5_000_000,
            balanceMinor: -1_000_000,
          },
        ],
      },
    ];
    state.queries['statements.listPdfs'] = [];
    state.queries['clients.get'] = { noReminders: false };
    render(<ClientBilling clientId={'c1' as never} permissions={FINANCE} />);
    const table = screen.getByRole('table', { name: 'NGN' });
    expect(table).toHaveTextContent('Opening balance');
    expect(table).toHaveTextContent('₦10,000.00 in credit');
    expect(screen.getByLabelText('Send this client payment reminders')).toBeChecked();
  });
});

describe('FxRates', () => {
  it('says whether each rate is recent, and saves a new one in micro-naira', async () => {
    state.queries['fx.current'] = [
      { currency: 'USD', date: '2026-09-21', rateToNgnMicro: 1_550_000_000, fresh: true },
      { currency: 'EUR', fresh: false },
    ];
    state.queries['fx.history'] = [];
    render(<FxRates />);
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText('No rate yet')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Naira per USD'), '1,560.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save the rate' }));
    await waitFor(() =>
      expect(state.mutations['fx.setRate']).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD', rateToNgnMicro: 1_560_500_000 }),
      ),
    );
  });
});
