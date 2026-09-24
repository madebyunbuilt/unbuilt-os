import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalDocument, PortalDocuments } from './portal-documents';
import { PortalInvoice } from './portal-invoices';
import { PortalHome } from './portal-home';

// The portal's screens (12-client-portal.md): a client is offered the one thing they are being asked to do, and is
// told plainly what accepting means before they do it.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue({ status: 'accepted' });
    return state.mutations[ref._name];
  },
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(['portal', 'portalDocuments', 'portalBilling', 'files'].map((n) => [n, functions(n)])),
  };
});

const quote = (overrides: object = {}) => ({
  id: 'd1',
  type: 'quote',
  typeLabel: 'Quote',
  number: 'UNB-Q-0001',
  title: 'Mobile app build',
  status: 'sent',
  currency: 'NGN',
  totals: {
    subtotalMinor: 1_000_000_00,
    discountMinor: 0,
    taxableMinor: 1_000_000_00,
    vatMinor: 0,
    totalMinor: 1_000_000_00,
    whtExpectedMinor: 0,
  },
  validUntilDate: '2026-10-24',
  sentAt: Date.parse('2026-09-24T09:00:00Z'),
  acceptedAt: undefined,
  declinedAt: undefined,
  declinedReason: undefined,
  signedAt: undefined,
  pdfFileId: undefined,
  asks: 'decision',
  signing: null,
  blocks: [{ kind: 'paragraph', text: 'Everything for Glossup.' }],
  lineItems: [],
  canDecide: true,
  ...overrides,
});

beforeEach(() => {
  state.queries = { 'portalDocuments.list': [quote()], 'portalDocuments.get': quote() };
  state.mutations = {};
});

describe('a client’s documents', () => {
  it('says what each one needs from them', () => {
    render(<PortalDocuments />);
    expect(screen.getByText('Needs your decision')).toBeInTheDocument();
    expect(screen.getByText('₦1,000,000.00')).toBeInTheDocument();
  });

  it('says what accepting commits them to, before they accept', async () => {
    render(<PortalDocument documentId={'d1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('dialog', { name: 'Accept this quote' });
    expect(dialog).toHaveTextContent('₦1,000,000.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(state.mutations['portalDocuments.decide']).toHaveBeenCalledWith({
        documentId: 'd1',
        decision: 'accepted',
      }),
    );
  });

  it('will not decline without a reason', async () => {
    render(<PortalDocument documentId={'d1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline this quote' });
    expect(within(dialog).getByRole('button', { name: 'Decline' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Why'), 'Going another way');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await waitFor(() =>
      expect(state.mutations['portalDocuments.decide']).toHaveBeenCalledWith({
        documentId: 'd1',
        decision: 'declined',
        note: 'Going another way',
      }),
    );
  });

  it('offers nothing to decide to somebody who may not commit the client', () => {
    state.queries['portalDocuments.get'] = quote({ canDecide: false });
    render(<PortalDocument documentId={'d1' as never} />);
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  const nda = (signing: string) =>
    quote({
      type: 'nda',
      typeLabel: 'Non-disclosure agreement',
      asks: 'signature',
      status: 'awaiting_signature',
      canDecide: false,
      totals: undefined,
      currency: undefined,
      signing,
    });

  it('does not claim a signature is needed before anybody has been asked', () => {
    state.queries['portalDocuments.get'] = nda('not_requested');
    render(<PortalDocument documentId={'d1' as never} />);
    expect(screen.getByText('Sent to you')).toBeInTheDocument();
    expect(screen.getByText(/has not asked for signatures yet/)).toBeInTheDocument();
    expect(screen.queryByText('Needs your signature')).not.toBeInTheDocument();
  });

  it('says a signature is needed once this person is the one being asked', () => {
    state.queries['portalDocuments.get'] = nda('mine');
    render(<PortalDocument documentId={'d1' as never} />);
    expect(screen.getByText('Needs your signature')).toBeInTheDocument();
    expect(screen.getByText(/link is in your email/)).toBeInTheDocument();
  });

  it('says it is with a colleague when somebody else is signing', () => {
    state.queries['portalDocuments.get'] = nda('others');
    render(<PortalDocument documentId={'d1' as never} />);
    expect(screen.getByText('Waiting for signatures')).toBeInTheDocument();
    expect(screen.getByText(/with your colleagues to sign/)).toBeInTheDocument();
  });
});

describe('the portal home', () => {
  it('says nothing is waiting when nothing is', () => {
    state.queries['portal.home'] = { clientName: 'Glossup', contactName: 'Ada Obi', waiting: [], projects: [] };
    render(<PortalHome />);
    expect(screen.getByText('Nothing is waiting on you right now.')).toBeInTheDocument();
    expect(screen.getByText('Hello, Ada')).toBeInTheDocument();
  });

  it('lists what needs them, with somewhere to go', () => {
    state.queries['portal.home'] = {
      clientName: 'Glossup',
      contactName: 'Ada Obi',
      waiting: [
        { kind: 'invoice', id: 'i1', title: 'Invoice UNB-INV-0001', detail: 'Due 2026-10-08', href: '/invoices/i1' },
      ],
      projects: [],
    };
    render(<PortalHome />);
    expect(screen.getByRole('link', { name: /Invoice UNB-INV-0001/ })).toHaveAttribute('href', '/invoices/i1');
  });
});

describe('a client’s invoice', () => {
  const invoice = (overrides: object = {}) => ({
    id: 'i1',
    number: 'UNB-INV-0001',
    typeLabel: 'Invoice',
    status: 'sent',
    currency: 'NGN',
    issueDate: '2026-09-24',
    dueDate: '2026-10-08',
    totalMinor: 100_000_00,
    balanceMinor: 100_000_00,
    paidMinor: 0,
    creditedMinor: 0,
    whtCreditedMinor: 0,
    pdfFileId: undefined,
    payable: true,
    lineItems: [],
    totals: {
      subtotalMinor: 100_000_00,
      discountMinor: 0,
      taxableMinor: 100_000_00,
      vatMinor: 0,
      totalMinor: 100_000_00,
      whtExpectedMinor: 0,
    },
    vat: { applies: false, bps: 0 },
    whtOnBalanceMinor: 0,
    payments: [],
    creditNotes: [],
    byCard: true,
    bankAccounts: [{ bankName: 'GTBank', accountName: 'Unbuilt Studio', accountNumber: '0123456789' }],
    ...overrides,
  });

  it('offers the pay button only when there is a link to open', async () => {
    state.queries['portalBilling.invoice'] = invoice();
    state.queries['portalBilling.payLink'] = { url: null };
    render(<PortalInvoice invoiceId={'i1' as never} />);
    expect(screen.queryByRole('link', { name: 'Pay this invoice' })).not.toBeInTheDocument();
    // The bank details are always there, so there is still a way to pay.
    expect(screen.getByText('0123456789')).toBeInTheDocument();
  });

  it('pays through the same page an emailed link opens, in a tab of its own', () => {
    state.queries['portalBilling.invoice'] = invoice();
    state.queries['portalBilling.payLink'] = { url: 'https://portal.example.com/pay/abc' };
    render(<PortalInvoice invoiceId={'i1' as never} />);
    const pay = screen.getByRole('link', { name: /Pay this invoice/ });
    expect(pay).toHaveAttribute('href', 'https://portal.example.com/pay/abc');
    // Paying leaves for Paystack and comes back to a page with no way into the portal, so this tab stays open.
    expect(pay).toHaveAttribute('target', '_blank');
    expect(pay).toHaveAccessibleName('Pay this invoice (opens in a new tab)');
  });

  it('tells a client who withholds tax what to send, and what to remit', () => {
    state.queries['portalBilling.invoice'] = invoice({ whtOnBalanceMinor: 5_000_00 });
    state.queries['portalBilling.payLink'] = { url: null };
    render(<PortalInvoice invoiceId={'i1' as never} />);
    expect(screen.getByText(/pay ₦95,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/certificate for ₦5,000.00/)).toBeInTheDocument();
  });

  it('words how they paid, and labels the reference so it is not read as an account', () => {
    state.queries['portalBilling.invoice'] = invoice({
      payments: [
        {
          id: 'p1',
          amountMinor: 14_040_00,
          receivedOn: '2026-09-23',
          method: 'paystack',
          instrument: 'Card · visa ending 4081',
          reference: '6586506623',
          receiptId: 'r1',
          receiptNumber: 'UNB-RCT-0005',
          receiptFileId: undefined,
        },
      ],
    });
    state.queries['portalBilling.payLink'] = { url: null };
    render(<PortalInvoice invoiceId={'i1' as never} />);
    expect(screen.getByText(/Card · visa ending 4081/)).toBeInTheDocument();
    expect(screen.getByText('Reference 6586506623')).toBeInTheDocument();
  });

  it('says how a manual payment arrived in words, not as a database value', () => {
    state.queries['portalBilling.invoice'] = invoice({
      payments: [
        {
          id: 'p1',
          amountMinor: 10_000_00,
          receivedOn: '2026-09-22',
          method: 'bank_transfer',
          instrument: undefined,
          reference: 'GTB/123',
          receiptId: undefined,
          receiptNumber: undefined,
          receiptFileId: undefined,
        },
      ],
    });
    state.queries['portalBilling.payLink'] = { url: null };
    render(<PortalInvoice invoiceId={'i1' as never} />);
    expect(screen.getByText(/Bank transfer/)).toBeInTheDocument();
    expect(screen.queryByText(/bank_transfer/)).not.toBeInTheDocument();
  });

  it('lets a client open the receipt for what they paid', () => {
    state.queries['portalBilling.invoice'] = invoice({
      payments: [
        {
          id: 'p1',
          amountMinor: 10_000_00,
          receivedOn: '2026-09-22',
          method: 'bank_transfer',
          instrument: undefined,
          reference: 'GTB/123',
          receiptId: 'r1',
          receiptNumber: 'UNB-RCT-0001',
          receiptFileId: 'f9',
        },
      ],
    });
    state.queries['portalBilling.payLink'] = { url: null };
    state.queries['files.portalDownloadUrl'] = { url: 'https://files.example.com/receipt.pdf', name: 'receipt.pdf' };
    render(<PortalInvoice invoiceId={'i1' as never} />);
    expect(screen.getByRole('link', { name: 'Receipt UNB-RCT-0001' })).toHaveAttribute(
      'href',
      'https://files.example.com/receipt.pdf',
    );
  });

  it('lets a client open a credit note', () => {
    state.queries['portalBilling.invoice'] = invoice({
      creditNotes: [
        { id: 'cn1', number: 'UNB-CN-0001', amountMinor: 5_000_00, issuedOn: '2026-09-22', pdfFileId: 'f8' },
      ],
    });
    state.queries['portalBilling.payLink'] = { url: null };
    state.queries['files.portalDownloadUrl'] = { url: 'https://files.example.com/credit.pdf', name: 'credit.pdf' };
    render(<PortalInvoice invoiceId={'i1' as never} />);
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'https://files.example.com/credit.pdf',
    );
  });

  it('tells a client a settled invoice is the one that was sent, and where the proof is', () => {
    state.queries['portalBilling.invoice'] = invoice({
      status: 'paid',
      paidMinor: 100_000_00,
      balanceMinor: 0,
      payable: false,
      payments: [
        {
          id: 'p1',
          amountMinor: 100_000_00,
          receivedOn: '2026-09-22',
          method: 'bank_transfer',
          instrument: undefined,
          reference: 'GTB/123',
          receiptId: 'r1',
          receiptNumber: 'UNB-RCT-0001',
          receiptFileId: 'f9',
        },
      ],
    });
    render(<PortalInvoice invoiceId={'i1' as never} />);
    expect(screen.getByText(/Settled on 22 Sep 2026/)).toBeInTheDocument();
    expect(screen.getByText(/receipt UNB-RCT-0001/)).toBeInTheDocument();
  });

  it('says a settled invoice is settled, and offers no payment', () => {
    state.queries['portalBilling.invoice'] = invoice({
      status: 'paid',
      paidMinor: 100_000_00,
      balanceMinor: 0,
      payable: false,
    });
    render(<PortalInvoice invoiceId={'i1' as never} />);
    // One label whatever the state: zero is the answer to "what do I owe", not a thing to relabel around.
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getByText('Still to pay')).toBeInTheDocument();
    expect(screen.getByText('₦0.00')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pay this invoice' })).not.toBeInTheDocument();
  });
});
