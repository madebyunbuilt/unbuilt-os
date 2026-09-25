import { render, screen, waitFor, within } from '@testing-library/react';
import { ConvexError } from 'convex/values';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalDocument, PortalDocuments } from './portal-documents';
import { PortalInvoice } from './portal-invoices';
import { PortalProject } from './portal-projects';
import { PortalColleagues } from './portal-colleagues';
import { PortalTicket, PortalTickets } from './portal-tickets';
import { PortalHome } from './portal-home';

// The portal's screens (12-client-portal.md): a client is offered the one thing they are being asked to do, and is
// told plainly what accepting means before they do it.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  push: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue({ status: 'accepted' });
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/tickets',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(
      [
        'portal',
        'portalDocuments',
        'portalBilling',
        'portalProjects',
        'portalColleagues',
        'portalTickets',
        'files',
      ].map((n) => [n, functions(n)]),
    ),
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
    expect(screen.getByText('Reference: 6586506623')).toBeInTheDocument();
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

describe('a client’s project', () => {
  const project = (overrides: object = {}) => ({
    id: 'p1',
    code: 'UNB-P-0001',
    name: 'Glossup app',
    status: 'active',
    startDate: '2026-09-01',
    dueDate: '2026-12-01',
    milestones: [],
    deliverables: [],
    changeRequests: [],
    retainer: null,
    ...overrides,
  });

  const deliverable = (overrides: object = {}) => ({
    id: 'd1',
    title: 'Onboarding flow',
    description: undefined,
    status: 'in_review',
    version: 1,
    approvedAt: undefined,
    files: [],
    links: [{ url: 'https://figma.com/flows', label: 'Figma' }],
    notes: 'First pass',
    needsYou: true,
    ...overrides,
  });

  const changeRequest = (overrides: object = {}) => ({
    id: 'cr1',
    number: 'UNB-CR-0001',
    title: 'A second onboarding screen',
    description: 'One more screen.',
    reason: 'User testing.',
    impact: { amountMinor: 200_000_00, currency: 'NGN', days: 5 },
    status: 'sent',
    needsSignature: false,
    documentId: undefined,
    declineReason: undefined,
    ...overrides,
  });

  it('offers a review only on what is waiting for them', () => {
    state.queries['portalProjects.project'] = project({
      deliverables: [deliverable(), deliverable({ id: 'd2', status: 'approved', needsYou: false })],
    });
    render(<PortalProject projectId={'p1' as never} />);
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(screen.getByText('Needs your review')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('approves the version it is showing, not whatever is newest', async () => {
    state.queries['portalProjects.project'] = project({ deliverables: [deliverable({ version: 3 })] });
    render(<PortalProject projectId={'p1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve Onboarding flow' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(state.mutations['portalProjects.decideDeliverable']).toHaveBeenCalledWith({
        deliverableId: 'd1',
        version: 3,
        decision: 'approved',
      }),
    );
  });

  it('will not send work back without saying what is wrong with it', async () => {
    state.queries['portalProjects.project'] = project({ deliverables: [deliverable()] });
    render(<PortalProject projectId={'p1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask for changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ask for changes to Onboarding flow' });
    expect(within(dialog).getByRole('button', { name: 'Send this back' })).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('What needs changing'), 'The logo is the old one');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send this back' }));
    await waitFor(() =>
      expect(state.mutations['portalProjects.decideDeliverable']).toHaveBeenCalledWith({
        deliverableId: 'd1',
        version: 1,
        decision: 'changes_requested',
        note: 'The logo is the old one',
      }),
    );
  });

  it('shows the files the studio submitted, not only the links', () => {
    state.queries['portalProjects.project'] = project({
      deliverables: [deliverable({ files: [{ id: 'f1', name: 'screen-two.png', sizeBytes: 1024 }] })],
    });
    state.queries['files.portalDownloadUrl'] = { url: 'https://files.example.com/screen-two.png', name: 'x.png' };
    render(<PortalProject projectId={'p1' as never} />);
    expect(screen.getByRole('link', { name: 'screen-two.png' })).toHaveAttribute(
      'href',
      'https://files.example.com/screen-two.png',
    );
  });

  it('says what agreeing a change commits them to', async () => {
    state.queries['portalProjects.project'] = project({ changeRequests: [changeRequest()] });
    render(<PortalProject projectId={'p1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve this change' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve this change' });
    expect(dialog).toHaveTextContent('₦200,000.00');
    expect(dialog).toHaveTextContent('5 more days');
  });

  it('sends them to their email when the change must be signed', () => {
    state.queries['portalProjects.project'] = project({
      changeRequests: [changeRequest({ needsSignature: true })],
    });
    render(<PortalProject projectId={'p1' as never} />);
    expect(screen.queryByRole('button', { name: 'Approve this change' })).not.toBeInTheDocument();
    expect(screen.getByText(/signing link is in your email/)).toBeInTheDocument();
    // Declining never needs a signature.
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  it('shows retainer hours without a price anywhere near them', () => {
    state.queries['portalProjects.project'] = project({
      retainer: {
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        includedMinutes: 600,
        usedMinutes: 300,
        remainingMinutes: 300,
        overageMinutes: 0,
      },
    });
    render(<PortalProject projectId={'p1' as never} />);
    expect(screen.getByText('5 of 10 hours used')).toBeInTheDocument();
    expect(screen.getByText(/5 left/)).toBeInTheDocument();
  });
});

describe('a client admin’s colleagues', () => {
  const colleague = (overrides: object = {}) => ({
    id: 'c1',
    name: 'Ada Obi',
    email: 'ada@glossup.com',
    jobTitle: 'Founder',
    hasAccess: true,
    role: 'client_admin',
    invitedAt: Date.parse('2026-09-20T09:00:00Z'),
    isYou: true,
    ...overrides,
  });

  it('never offers somebody the means to lock themselves out', () => {
    state.queries['portalColleagues.list'] = [
      colleague(),
      colleague({ id: 'c2', name: 'Kunle Bakare', email: 'kunle@glossup.com', role: 'client_member', isYou: false }),
    ];
    render(<PortalColleagues />);
    expect(screen.getByText('you')).toBeInTheDocument();
    // One row has the button, and it is not theirs.
    const remove = screen.getAllByRole('button', { name: 'Remove access' });
    expect(remove).toHaveLength(1);
  });

  it('lets a contact Unbuilt already holds in, without asking for their details again', async () => {
    state.queries['portalColleagues.list'] = [
      colleague(),
      colleague({
        id: 'c2',
        name: 'Bisi Accounts',
        email: 'accounts@glossup.com',
        hasAccess: false,
        role: null,
        invitedAt: undefined,
        isYou: false,
      }),
    ];
    render(<PortalColleagues />);
    expect(screen.getByText('No access')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Give access' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Name')).toBeDisabled();
    await userEvent.selectOptions(dialog.getByLabelText('What they can do'), 'client_admin');
    await userEvent.click(dialog.getByRole('button', { name: 'Give access' }));
    await waitFor(() =>
      expect(state.mutations['portalColleagues.invite']).toHaveBeenCalledWith({
        name: 'Bisi Accounts',
        email: 'accounts@glossup.com',
        jobTitle: 'Founder',
        role: 'client_admin',
      }),
    );
  });

  it('says what removing access does, and what it leaves alone', async () => {
    state.queries['portalColleagues.list'] = [colleague({ isYou: false })];
    render(<PortalColleagues />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove access' }));
    expect(screen.getByText(/nothing already approved or signed changes/)).toBeInTheDocument();
  });

  it('gives the server’s reason when a change would leave nobody able to approve or pay', async () => {
    state.queries['portalColleagues.list'] = [colleague()];
    state.mutations['portalColleagues.setRole'] = vi
      .fn()
      .mockRejectedValue(
        new ConvexError({ code: 'crm.lastAdmin', message: 'Somebody has to be able to approve and pay.' }),
      );
    render(<PortalColleagues />);
    await userEvent.selectOptions(screen.getByLabelText('What Ada Obi can do'), 'client_member');
    expect(await screen.findByRole('alert')).toHaveTextContent('Somebody has to be able to approve and pay.');
  });
});

describe('support in the portal', () => {
  const ticket = (overrides: object = {}) => ({
    id: 'tk1',
    number: 'UNB-TKT-0001',
    subject: 'Checkout is down',
    priority: 'p2',
    status: 'with_unbuilt',
    projectId: undefined,
    createdAt: Date.parse('2026-10-12T09:00:00Z'),
    resolvedAt: undefined,
    canReopen: false,
    ...overrides,
  });

  const thread = (overrides: object = {}) => ({
    ...ticket(),
    projectName: undefined,
    messages: [
      {
        id: 'm1',
        body: 'Nobody can pay.',
        fromUnbuilt: false,
        authorContactId: 'ct1',
        files: [],
        createdAt: Date.parse('2026-10-12T09:00:00Z'),
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    state.queries['portalTickets.list'] = [ticket()];
    state.queries['portalTickets.get'] = thread();
    state.queries['portal.projects'] = [];
    state.push.mockClear();
  });

  it('does not promise an email that is not coming', async () => {
    render(<PortalTickets />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask for help' }));
    const dialog = within(await screen.findByRole('dialog'));
    // Until the communications step delivers them, a reply only ever arrives in the portal.
    expect(dialog.queryByText(/email/i)).not.toBeInTheDocument();
  });

  it('asks how bad it is in the client’s words, never in P-codes', async () => {
    render(<PortalTickets />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask for help' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('option', { name: 'Everything is down, or data is at risk' })).toBeInTheDocument();
    expect(dialog.queryByText(/P1/)).not.toBeInTheDocument();
  });

  it('sends what they typed', async () => {
    render(<PortalTickets />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask for help' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('What is it about'), 'Cards declined');
    await userEvent.selectOptions(dialog.getByLabelText('How bad is it'), 'p1');
    await userEvent.type(dialog.getByLabelText('What is happening'), 'Every card fails.');
    await userEvent.click(dialog.getByRole('button', { name: 'Send it' }));
    await waitFor(() =>
      expect(state.mutations['portalTickets.create']).toHaveBeenCalledWith({
        subject: 'Cards declined',
        description: 'Every card fails.',
        priority: 'p1',
        projectId: undefined,
        uploads: [],
      }),
    );
  });

  it('lets a client send a screenshot with what they report', async () => {
    render(<PortalTickets />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask for help' }));
    const dialog = within(await screen.findByRole('dialog'));
    const shot = new File(['pretend'], 'broken.png', { type: 'image/png' });
    await userEvent.upload(dialog.getByLabelText('Add a screenshot or a file'), shot);
    // Listed by name before it goes anywhere, with a way to take it back off.
    expect(dialog.getByRole('button', { name: 'Remove broken.png' })).toBeInTheDocument();
  });

  it('shows a file Unbuilt sent back', () => {
    state.queries['portalTickets.get'] = thread({
      messages: [
        {
          id: 'm2',
          body: 'This is what we changed.',
          fromUnbuilt: true,
          authorContactId: undefined,
          files: [{ id: 'f1', name: 'fix.png' }],
          createdAt: Date.parse('2026-10-12T10:00:00Z'),
        },
      ],
    });
    state.queries['files.portalDownloadUrl'] = { url: 'https://example.test/fix.png', name: 'fix.png' };
    render(<PortalTicket ticketId={'tk1' as never} />);
    expect(screen.getByRole('link', { name: 'fix.png' })).toHaveAttribute('href', 'https://example.test/fix.png');
  });

  it('says whose turn it is, without ever showing an SLA', () => {
    state.queries['portalTickets.get'] = thread({ status: 'with_you' });
    render(<PortalTicket ticketId={'tk1' as never} />);
    expect(screen.getByText(/waiting on your answer/)).toBeInTheDocument();
    expect(screen.queryByText(/due in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SLA/)).not.toBeInTheDocument();
  });

  it('offers to reopen something resolved this week', () => {
    state.queries['portalTickets.get'] = thread({ status: 'resolved', canReopen: true });
    render(<PortalTicket ticketId={'tk1' as never} />);
    expect(screen.getByText(/reply below and it opens again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('warns that a late reply starts a new ticket, before they type it', () => {
    state.queries['portalTickets.get'] = thread({ status: 'resolved', canReopen: false });
    render(<PortalTicket ticketId={'tk1' as never} />);
    expect(screen.getByText(/starts a new ticket/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new ticket' })).toBeInTheDocument();
  });

  it('follows the client to the new ticket when one is started', async () => {
    state.queries['portalTickets.get'] = thread({ status: 'closed' });
    state.mutations['portalTickets.reply'] = vi.fn().mockResolvedValue({ ticketId: 'tk2', isNew: true });
    render(<PortalTicket ticketId={'tk1' as never} />);
    await userEvent.type(screen.getByLabelText('Reply'), 'It is back.');
    await userEvent.click(screen.getByRole('button', { name: 'Start a new ticket' }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/tickets/tk2'));
  });
});
