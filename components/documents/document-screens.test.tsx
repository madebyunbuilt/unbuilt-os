import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentList } from './document-list';
import { DocumentPage } from './document-page';

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
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue(undefined);
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/documents',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(
      [
        'documents',
        'documentTemplates',
        'clients',
        'contacts',
        'rateCard',
        'files',
        'signatures',
        'team',
        'deals',
        'projects',
      ].map((name) => [name, functions(name)]),
    ),
  };
});

const totals = {
  subtotalMinor: 2_000_000,
  discountMinor: 0,
  taxableMinor: 1_000_000,
  vatMinor: 75_000,
  totalMinor: 2_075_000,
  whtExpectedMinor: 100_000,
};

const listRow = (overrides: object = {}) => ({
  id: 'd1',
  type: 'quote',
  typeLabel: 'Quote',
  number: 'UNB-QUO-0001',
  title: 'Glossup app, phase one',
  status: 'sent',
  clientId: 'c1',
  clientName: 'Glossup',
  projectId: undefined,
  projectName: undefined,
  dealId: undefined,
  currency: 'NGN',
  totals,
  validUntilDate: '2026-10-21',
  currentVersion: 1,
  parentDocumentId: undefined,
  chainRootId: 'd1',
  sentAt: Date.parse('2026-09-21T09:00:00Z'),
  firstViewedAt: undefined,
  viewCount: 0,
  acceptedAt: undefined,
  declinedAt: undefined,
  declinedReason: undefined,
  decisionNote: undefined,
  signedAt: undefined,
  voidReason: undefined,
  pdfFileId: 'f1',
  pdfSha256: 'a'.repeat(64),
  createdAt: Date.parse('2026-09-20T09:00:00Z'),
  ...overrides,
});

const wording = [
  { kind: 'heading', text: '{{document.title}}' },
  { kind: 'paragraph', text: 'Prepared for {{contact.name}} at {{client.displayName}}.' },
  { kind: 'lineItems', title: 'The work' },
  { kind: 'totals' },
  { kind: 'signature', party: 'client' },
];

const document = (overrides: object = {}) => ({
  ...listRow(),
  // What the client reads, and the wording underneath it with its variables intact.
  rawBlocks: wording,
  blocks: [
    { kind: 'heading', text: 'Quote UNB-QUO-0001' },
    { kind: 'paragraph', text: 'Prepared for Ada Obi at Glossup.' },
    { kind: 'lineItems', title: 'The work' },
    { kind: 'totals' },
    { kind: 'signature', party: 'client' },
  ],
  lineItems: [
    { description: 'Design', quantityMilli: 1_000, unitPriceMinor: 1_000_000, amountMinor: 1_000_000, taxable: true },
    { description: 'Build', quantityMilli: 2_000, unitPriceMinor: 500_000, amountMinor: 1_000_000, taxable: false },
  ],
  discount: { kind: 'none' },
  vat: { applies: true, bps: 750 },
  wht: { applies: true, bps: 500 },
  templateId: 't1',
  templateVersion: 1,
  missing: [],
  createdByName: 'Kemi Bello',
  chain: [{ id: 'd1', type: 'quote', typeLabel: 'Quote', number: 'UNB-QUO-0001', status: 'sent', createdAt: 1 }],
  versions: [{ version: 1, createdAt: Date.parse('2026-09-21T09:00:00Z'), changeNote: undefined, hasPdf: true }],
  ...overrides,
});

const FULL = [
  'documents.view',
  'documents.create',
  'documents.update',
  'documents.send',
  'documents.void',
  'clients.view',
  'ratecard.view',
];
const READER = ['documents.view'];

beforeEach(() => {
  state.queries = {
    'documents.list': [listRow()],
    'documents.get': document(),
    'clients.list': [{ id: 'c1', displayName: 'Glossup' }],
    'documentTemplates.list': [
      { id: 't1', name: 'Quote', type: 'quote', isDefault: true, requiresLegalReview: false, needsLegalReview: false },
      {
        id: 't2',
        name: 'Contract',
        type: 'contract',
        isDefault: true,
        requiresLegalReview: true,
        needsLegalReview: true,
      },
      // A legal template the Owner has recorded the lawyer's approval of, for the version it is now.
      {
        id: 't3',
        name: 'Approved NDA',
        type: 'nda',
        isDefault: true,
        requiresLegalReview: true,
        needsLegalReview: false,
      },
    ],
    'contacts.listForClient': [
      { id: 'ct1', name: 'Ada Obi', email: 'ada@glossup.com', isPrimary: true, status: 'active' },
      { id: 'ct2', name: 'Bayo Ade', email: 'bayo@glossup.com', isPrimary: false, status: 'active' },
    ],
    'rateCard.list': [
      { id: 'rc1', name: 'Design day', prices: [{ currency: 'NGN', unitPriceMinor: 15_000_000 }], taxable: true },
    ],
  };
  state.queryArgs = {};
  state.mutations = {};
  state.push.mockClear();
});

describe('DocumentList', () => {
  it('lists documents with their totals and filters them', async () => {
    render(<DocumentList permissions={FULL} />);

    const row = screen.getByRole('row', { name: /Glossup app/ });
    expect(row).toHaveTextContent('Quote · UNB-QUO-0001');
    expect(row).toHaveTextContent('With the client');
    expect(row).toHaveTextContent('₦20,750.00');
    expect(screen.getByRole('link', { name: /Glossup app/ })).toHaveAttribute('href', '/documents/d1');

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'sow');
    expect(state.queryArgs['documents.list']).toMatchObject({ type: 'sow' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'accepted');
    expect(state.queryArgs['documents.list']).toMatchObject({ status: 'accepted' });
  });

  it('creates a draft with priced lines and opens it', async () => {
    state.mutations['documents.create'] = vi.fn().mockResolvedValue('d9');
    render(<DocumentList permissions={FULL} />);

    await userEvent.click(screen.getByRole('button', { name: 'New document' }));
    const dialog = await screen.findByRole('dialog', { name: 'New document' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Client'), 'c1');
    await userEvent.type(within(dialog).getByLabelText('Title (optional)'), 'Phase two');
    await userEvent.type(within(dialog).getByLabelText('Line 1 description'), 'Discovery');
    await userEvent.type(within(dialog).getByLabelText('Unit price (NGN)'), '250000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    await waitFor(() =>
      expect(state.mutations['documents.create']).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'quote',
          clientId: 'c1',
          title: 'Phase two',
          currency: 'NGN',
          lineItems: [
            expect.objectContaining({ description: 'Discovery', quantityMilli: 1000, unitPriceMinor: 25_000_000 }),
          ],
        }),
      ),
    );
    expect(state.push).toHaveBeenCalledWith('/documents/d9');
  });

  it('warns that a legal template still needs a lawyer', async () => {
    render(<DocumentList permissions={FULL} />);
    await userEvent.click(screen.getByRole('button', { name: 'New document' }));
    const dialog = await screen.findByRole('dialog', { name: 'New document' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'contract');
    await userEvent.selectOptions(within(dialog).getByLabelText('Template'), 't2');
    expect(within(dialog).getByText(/needs your lawyer/)).toBeInTheDocument();

    // Once the lawyer has approved the wording as it stands, there is nothing to warn about.
    await userEvent.selectOptions(within(dialog).getByLabelText('Template'), 't3');
    expect(within(dialog).queryByText(/needs your lawyer/)).not.toBeInTheDocument();
  });

  it('offers nothing to create without documents.create', () => {
    render(<DocumentList permissions={READER} />);
    expect(screen.queryByRole('button', { name: 'New document' })).not.toBeInTheDocument();
  });
});

describe('DocumentPage', () => {
  it('shows the document, records a team view, and offers the PDF', async () => {
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Glossup app, phase one' })).toBeInTheDocument();
    expect(screen.getByText(/Quote · UNB-QUO-0001/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'The work' })).toHaveTextContent('Design');
    expect(screen.getByText('₦20,750.00')).toBeInTheDocument();

    // Looking at it is recorded, and never counts as the client opening it.
    await waitFor(() => expect(state.mutations['documents.logTeamView']).toHaveBeenCalledWith({ documentId: 'd1' }));
    expect(screen.getByRole('button', { name: /Download the PDF/ })).toBeInTheDocument();
  });

  it('sends a draft to the contacts chosen', async () => {
    state.queries['documents.get'] = document({ status: 'draft', number: undefined, currentVersion: 0, versions: [] });
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);

    await userEvent.click(screen.getByRole('button', { name: 'Send to the client' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send this document' });
    // The main contact is ticked already; add the second.
    await userEvent.click(within(dialog).getByLabelText(/Bayo Ade/));
    await userEvent.type(within(dialog).getByLabelText('A note with it (optional)'), 'Any questions, call me.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(state.mutations['documents.send']).toHaveBeenCalledWith({
        documentId: 'd1',
        contactIds: ['ct1', 'ct2'],
        message: 'Any questions, call me.',
        changeNote: undefined,
      }),
    );
  });

  it('lists what is missing, with where to fill it, and holds the send until it is filled', () => {
    state.queries['documents.get'] = document({
      status: 'draft',
      number: undefined,
      currentVersion: 0,
      versions: [],
      missing: [
        {
          label: 'The studio’s registered name',
          where: 'Add it in Settings → Organisation.',
          href: '/settings/organisation',
        },
      ],
    });
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Fill these in before sending');
    expect(notice).toHaveTextContent('The studio’s registered name. Add it in Settings → Organisation.');
    expect(within(notice).getByRole('link', { name: 'Go there' })).toHaveAttribute('href', '/settings/organisation');
    expect(screen.getByRole('button', { name: 'Send to the client' })).toBeDisabled();
  });

  it('puts a missing deal, project or payment schedule right from the notice', async () => {
    state.queries['documents.get'] = document({
      status: 'draft',
      number: undefined,
      currentVersion: 0,
      versions: [],
      missing: [
        { label: 'The deal this came from', where: 'This document is not linked to a deal.', fix: 'linkDeal' },
        { label: 'The project’s name', where: 'This document is not linked to a project.', fix: 'linkProject' },
        { label: 'The payment schedule in words', where: 'Write it as it should read.', fix: 'paymentSchedule' },
      ],
    });
    state.queries['deals.list'] = [{ id: 'dl1', title: 'Glossup app' }];
    state.queries['projects.list'] = [{ id: 'p1', code: 'UNB-P-0001', name: 'Glossup app' }];
    render(<DocumentPage documentId={'d1' as never} permissions={[...FULL, 'deals.view']} />);

    await userEvent.selectOptions(screen.getByLabelText('Choose a deal'), 'dl1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Link' })[0]);
    await waitFor(() =>
      expect(state.mutations['documents.link']).toHaveBeenCalledWith({ documentId: 'd1', dealId: 'dl1' }),
    );
    expect(state.queryArgs['deals.list']).toEqual({ clientId: 'c1', status: 'all' });

    await userEvent.selectOptions(screen.getByLabelText('Choose a project'), 'p1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Link' })[1]);
    await waitFor(() =>
      expect(state.mutations['documents.link']).toHaveBeenCalledWith({ documentId: 'd1', projectId: 'p1' }),
    );

    await userEvent.type(screen.getByLabelText('Payment schedule'), '50% on signature, 50% on completion');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.mutations['documents.setPaymentSchedule']).toHaveBeenCalledWith({
        documentId: 'd1',
        paymentScheduleSummary: '50% on signature, 50% on completion',
      }),
    );
  });

  it('only offers the fixes to someone who may edit the draft', () => {
    state.queries['documents.get'] = document({
      status: 'draft',
      number: undefined,
      currentVersion: 0,
      versions: [],
      missing: [{ label: 'The payment schedule in words', where: 'Write it.', fix: 'paymentSchedule' }],
    });
    render(<DocumentPage documentId={'d1' as never} permissions={READER} />);
    expect(screen.getByRole('status')).toHaveTextContent('The payment schedule in words');
    expect(screen.queryByLabelText('Payment schedule')).not.toBeInTheDocument();
  });

  it('offers a corrected version of an agreement waiting to be signed, and says what it still lacks', () => {
    state.queries['documents.get'] = document({
      type: 'nda',
      typeLabel: 'Non-disclosure agreement',
      status: 'awaiting_signature',
      missing: [
        {
          label: 'The studio’s address, on one line',
          where: 'Settings → Organisation',
          href: '/settings/organisation',
        },
      ],
    });
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);

    expect(screen.getByRole('status')).toHaveTextContent('The studio’s address, on one line');
    expect(screen.getByRole('button', { name: 'Send the next version' })).toBeDisabled();
    // An agreement is signed, not accepted: there is no decision to record.
    expect(screen.queryByRole('button', { name: 'Record acceptance' })).not.toBeInTheDocument();
  });

  it('records what the client said while it is with them', async () => {
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);

    await userEvent.click(screen.getByRole('button', { name: 'Record acceptance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record acceptance' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Who said so (optional)'), 'ct1');
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'Confirmed by email');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record the acceptance' }));

    await waitFor(() =>
      expect(state.mutations['documents.recordDecision']).toHaveBeenCalledWith({
        documentId: 'd1',
        decision: 'accepted',
        contactId: 'ct1',
        note: 'Confirmed by email',
      }),
    );
  });

  it('edits a draft and re-prices it', async () => {
    state.queries['documents.get'] = document({ status: 'draft', number: undefined, currentVersion: 0, versions: [] });
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);

    await userEvent.click(screen.getByRole('button', { name: 'Edit the draft' }));
    const form = screen.getByRole('form', { name: 'Edit the draft' });
    await userEvent.clear(within(form).getByLabelText('Title'));
    await userEvent.type(within(form).getByLabelText('Title'), 'Phase one, revised');
    await userEvent.click(within(form).getByRole('button', { name: 'Save the draft' }));

    await waitFor(() =>
      expect(state.mutations['documents.update']).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'd1', title: 'Phase one, revised' }),
      ),
    );
  });

  it('shows a decline and a void with their reasons', () => {
    state.queries['documents.get'] = document({ status: 'declined', declinedReason: 'Budget moved to next year' });
    const { unmount } = render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);
    expect(screen.getByText(/Budget moved to next year/)).toBeInTheDocument();
    unmount();

    state.queries['documents.get'] = document({ status: 'void', voidReason: 'Sent to the wrong client' });
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);
    expect(screen.getByText(/Sent to the wrong client/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('offers a reader nothing but the document and its PDF', () => {
    render(<DocumentPage documentId={'d1' as never} permissions={READER} />);
    expect(screen.queryByRole('button', { name: /^Send/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record acceptance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit the draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download the PDF/ })).toBeInTheDocument();
  });

  it('never offers a signed document for voiding or editing', () => {
    state.queries['documents.get'] = document({ status: 'signed', signedAt: Date.now() });
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit the draft' })).not.toBeInTheDocument();
  });
});

describe('SignaturesPanel', () => {
  const nda = (overrides: object = {}) =>
    document({ type: 'nda', typeLabel: 'Non-disclosure agreement', status: 'awaiting_signature', ...overrides });

  const request = (overrides: object = {}) => ({
    id: 'r1',
    createdAt: Date.parse('2026-09-22T09:00:00Z'),
    documentId: 'd1',
    documentVersion: 1,
    pdfSha256: 'a'.repeat(64),
    order: 'sequential',
    status: 'pending',
    expiresAt: Date.parse('2026-10-06T09:00:00Z'),
    signers: [
      {
        id: 'c1',
        name: 'Ada Obi',
        email: 'ada@glossup.com',
        kind: 'client_contact',
        order: 0,
        status: 'locked',
        isViewer: false,
      },
      {
        id: 's1',
        name: 'Kemi Bello',
        email: 'kemi@unbuilt.studio',
        kind: 'team_member',
        memberId: 'm1',
        order: 1,
        status: 'invited',
        isViewer: true,
      },
    ],
    ...overrides,
  });

  it('sets up a request with the primary contact ticked, a countersigner and the order', async () => {
    state.queries['documents.get'] = nda();
    state.queries['signatures.listForDocument'] = [];
    state.queries['signatures.countersigners'] = [{ id: 'm1', name: 'Kemi Bello', email: 'kemi@unbuilt.studio' }];
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);

    expect(screen.getByText('Nobody has been asked to sign this yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send for signature' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send for signature' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Countersigned by the studio'), 'm1');
    await userEvent.selectOptions(within(dialog).getByLabelText('Order'), 'parallel');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send the links' }));

    await waitFor(() =>
      expect(state.mutations['signatures.createRequest']).toHaveBeenCalledWith({
        documentId: 'd1',
        contactIds: ['ct1'],
        countersignerMemberId: 'm1',
        order: 'parallel',
        expiresInDays: 14,
      }),
    );
  });

  it('follows each signer, unlocks a locked link, and offers the countersignature only to its member', async () => {
    state.queries['documents.get'] = nda({ signingOpen: true });
    state.queries['signatures.listForDocument'] = [request()];
    render(<DocumentPage documentId={'d1' as never} permissions={[...FULL, 'documents.countersign']} />);

    expect(screen.getByText('Locked: too many wrong codes')).toBeInTheDocument();
    // A new version cannot go out while signing is under way, and no second request can start.
    expect(screen.queryByRole('button', { name: 'Send the next version' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for signature' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Unlock with a new link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send it' }));
    await waitFor(() =>
      expect(state.mutations['signatures.resendLink']).toHaveBeenCalledWith({ requestId: 'r1', signerId: 'c1' }),
    );

    expect(screen.getByRole('button', { name: 'Countersign' })).toBeInTheDocument();
  });

  it('keeps the countersignature from anyone else, and the controls from a reader', () => {
    state.queries['documents.get'] = nda({ signingOpen: true });
    state.queries['signatures.listForDocument'] = [
      request({ signers: request().signers.map((signer) => ({ ...signer, isViewer: false })) }),
    ];
    render(<DocumentPage documentId={'d1' as never} permissions={READER} />);
    expect(screen.queryByRole('button', { name: 'Countersign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel the request' })).not.toBeInTheDocument();
  });

  it('countersigns with a typed name and consent', async () => {
    state.queries['documents.get'] = nda({ signingOpen: true });
    state.queries['signatures.listForDocument'] = [request()];
    state.queries['team.me'] = { name: 'Kemi Bello' };
    render(<DocumentPage documentId={'d1' as never} permissions={[...FULL, 'documents.countersign']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Countersign' }));
    const dialog = await screen.findByRole('alertdialog');
    const sign = within(dialog).getByRole('button', { name: 'Sign' });
    expect(sign).toBeDisabled();
    // Drawing is offered too; typing is the default.
    expect(within(dialog).getByRole('radio', { name: 'Draw it' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(within(dialog).getByLabelText(/legal equivalent of my handwritten signature/));
    await userEvent.click(sign);
    await waitFor(() =>
      expect(state.mutations['signatures.countersign']).toHaveBeenCalledWith({
        requestId: 'r1',
        method: 'typed',
        typedName: 'Kemi Bello',
        imageStorageId: undefined,
        consent: true,
      }),
    );
  });

  it('offers the signed PDF and the tamper check once everyone has signed', async () => {
    state.queries['documents.get'] = nda({ status: 'signed' });
    state.queries['signatures.listForDocument'] = [
      request({
        status: 'completed',
        completedAt: Date.parse('2026-09-23T10:00:00Z'),
        finalPdfFileId: 'f9',
        finalPdfSha256: 'b'.repeat(64),
        lastVerification: { checkedAt: Date.parse('2026-09-24T10:00:00Z'), ok: true, byMemberId: 'm1' },
        signers: request().signers.map((signer) => ({ ...signer, status: 'signed', isViewer: false })),
      }),
    ];
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);

    expect(screen.getByRole('button', { name: /Download the signed PDF/ })).toBeInTheDocument();
    expect(screen.getByText(/the stored files are unchanged/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(state.mutations['signatures.verify']).toHaveBeenCalledWith({ requestId: 'r1' }));
  });

  it('is not shown on a quote, which is accepted rather than signed', () => {
    state.queries['signatures.listForDocument'] = [];
    render(<DocumentPage documentId={'d1' as never} permissions={FULL} />);
    expect(screen.queryByRole('heading', { name: 'Signatures' })).not.toBeInTheDocument();
  });
});
