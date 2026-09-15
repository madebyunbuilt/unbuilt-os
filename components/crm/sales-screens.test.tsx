import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineSettings } from '@/components/settings/pipeline-settings';
import { ClientDeals } from './client-deals';
import { DealBoard } from './deal-board';
import { DealDetail } from './deal-detail';
import { EnquiryDetail } from './enquiry-detail';
import { EnquiryList } from './enquiry-list';

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
  usePaginatedQuery: (ref: { _name: string }, args: unknown) => {
    state.queryArgs[ref._name] = args;
    return { results: [], status: 'Exhausted', loadMore: vi.fn() };
  },
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue(undefined);
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/crm/deals',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(
      ['clients', 'contacts', 'activities', 'deals', 'enquiries', 'pipeline', 'team'].map((name) => [
        name,
        functions(name),
      ]),
    ),
  };
});

const PM = [
  'clients.view',
  'clients.create',
  'contacts.manage',
  'deals.view',
  'deals.manage',
  'enquiries.view',
  'enquiries.manage',
  'team.view',
];
const FINANCE = ['clients.view', 'deals.view', 'enquiries.view', 'team.view'];

const stages = [
  { id: 's_new', name: 'New', kind: 'open', probabilityBps: 1000, order: 0, dealCount: 1 },
  { id: 's_prop', name: 'Proposal sent', kind: 'open', probabilityBps: 5000, order: 1, dealCount: 0 },
  { id: 's_won', name: 'Won', kind: 'won', probabilityBps: 10000, order: 2, dealCount: 0 },
  { id: 's_lost', name: 'Lost', kind: 'lost', probabilityBps: 0, order: 3, dealCount: 0 },
];

const deal = (overrides: object = {}) => ({
  id: 'd1',
  title: 'E-commerce rebuild',
  clientId: 'c1',
  clientName: 'Glossup',
  primaryContact: null,
  stage: { id: 's_new', name: 'New', kind: 'open' },
  valueMinor: 500_000_000,
  currency: 'NGN',
  probabilityBps: 1000,
  ownerMemberId: 'mtobi',
  ownerName: 'Tobi Ade',
  services: ['web'],
  nextFollowUpDate: '2026-09-25',
  lastActivityAt: 1,
  createdAt: 1,
  ...overrides,
});

const enquiry = (overrides: object = {}) => ({
  id: 'e1',
  source: 'website',
  name: 'Tolu Adeyemi',
  email: 'tolu@glowhaus.co',
  company: 'Glowhaus',
  services: [{ slug: 'web', label: 'Web platforms' }],
  budget: '₦4m to ₦12m',
  status: 'new',
  receivedAt: Date.parse('2026-09-14T09:00:00Z'),
  existingClient: null,
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'pipeline.stages': stages,
    'pipeline.lostReasons': [
      { id: 'r_budget', label: 'Budget', active: true },
      { id: 'r_timing', label: 'Timing', active: true },
    ],
    'team.me': { id: 'mtobi' },
    'team.list': [{ id: 'mtobi', name: 'Tobi Ade', status: 'active' }],
    'clients.list': [{ id: 'c1', displayName: 'Glossup' }],
    'contacts.listForClient': [],
  };
  state.queryArgs = {};
  state.mutations = {};
  state.push.mockClear();
});

describe('EnquiryList', () => {
  it('switches between views and adds an enquiry that came by email', async () => {
    state.queries['enquiries.list'] = [enquiry({ existingClient: { id: 'c1', name: 'Glossup' } })];
    render(<EnquiryList canManage />);
    const [row] = within(screen.getByRole('list', { name: 'Enquiries' })).getAllByRole('listitem');
    expect(row).toHaveTextContent('Tolu AdeyemiGlowhausNewClient: Glossup');
    expect(row).toHaveTextContent('Web platforms · ₦4m to ₦12m');

    await userEvent.click(screen.getByRole('button', { name: 'Spam' }));
    expect(state.queryArgs['enquiries.list']).toEqual({ view: 'spam' });

    state.mutations['enquiries.createManual'] = vi.fn().mockResolvedValue('e9');
    await userEvent.click(screen.getByRole('button', { name: 'Add enquiry' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an enquiry' });
    await userEvent.selectOptions(within(dialog).getByLabelText('How it came in'), 'referral');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Bisi');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'bisi@example.com');
    await userEvent.click(within(dialog).getByLabelText('Mobile apps'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add enquiry' }));
    await waitFor(() =>
      expect(state.mutations['enquiries.createManual']).toHaveBeenCalledWith({
        source: 'referral',
        name: 'Bisi',
        email: 'bisi@example.com',
        company: undefined,
        about: undefined,
        services: ['mobile'],
      }),
    );
    expect(state.push).toHaveBeenCalledWith('/crm/enquiries/e9');
  });
});

describe('EnquiryDetail', () => {
  const detail = (overrides: object = {}) => ({
    ...enquiry(),
    stage: 'Designs, no code',
    timeline: 'In one to three months',
    about: 'A booking platform for salons.',
    existing: [],
    suggestedClient: { clientId: 'c1', clientName: 'Glossup', reason: 'domain' },
    ...overrides,
  });

  it('marks a new enquiry reviewed and converts it for the suggested client', async () => {
    state.queries['enquiries.get'] = detail();
    state.mutations['enquiries.convert'] = vi
      .fn()
      .mockResolvedValue({ clientId: 'c1', contactId: 'ct1', dealId: 'd7' });
    render(<EnquiryDetail enquiryId={'e1' as never} permissions={PM} />);

    await waitFor(() => expect(state.mutations['enquiries.markReviewed']).toHaveBeenCalledWith({ enquiryId: 'e1' }));
    expect(screen.getByText('A booking platform for salons.')).toBeInTheDocument();
    expect(screen.queryByText('Sent from')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Convert' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Suggested client: Glossup. Same company email domain.');
    expect(within(dialog).getByLabelText('Client')).toHaveValue('c1');
    await userEvent.type(within(dialog).getByLabelText('Estimated value'), '8,000,000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Convert to a deal' }));
    await waitFor(() =>
      expect(state.mutations['enquiries.convert']).toHaveBeenCalledWith({
        enquiryId: 'e1',
        client: { kind: 'existing', clientId: 'c1' },
        deal: { title: 'Web platforms for Glowhaus', valueMinor: 800_000_000, currency: 'NGN' },
      }),
    );
    expect(state.push).toHaveBeenCalledWith('/crm/deals/d7');
  });

  it('converts into a new client when there is no match', async () => {
    state.queries['enquiries.get'] = detail({ suggestedClient: null, status: 'reviewed' });
    render(<EnquiryDetail enquiryId={'e1' as never} permissions={PM} />);
    await userEvent.click(screen.getByRole('button', { name: 'Convert' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Client')).toHaveValue('new');
    expect(within(dialog).getByLabelText('New client’s name')).toHaveValue('Glowhaus');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Convert to a deal' }));
    await waitFor(() =>
      expect(state.mutations['enquiries.convert']).toHaveBeenCalledWith(
        expect.objectContaining({ client: { kind: 'new', displayName: 'Glowhaus', clientKind: 'company' } }),
      ),
    );
    expect(state.mutations['enquiries.markReviewed']).not.toHaveBeenCalled();
  });

  it('is read-only for Finance and shows the sender’s IP only when the query returned it', () => {
    state.queries['enquiries.get'] = detail({ ip: '203.0.113.7', userAgent: 'Mozilla/5.0' });
    render(<EnquiryDetail enquiryId={'e1' as never} permissions={FINANCE} />);
    expect(screen.getByText('203.0.113.7 · Mozilla/5.0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convert' })).not.toBeInTheDocument();
    expect(state.mutations['enquiries.markReviewed']).not.toHaveBeenCalled();
  });
});

describe('DealBoard', () => {
  beforeEach(() => {
    state.queries['deals.board'] = stages.map((stage) => ({
      ...stage,
      deals: stage.id === 's_new' ? [deal()] : [],
    }));
    state.queries['deals.pipelineSummary'] = { NGN: { count: 1, valueMinor: 500_000_000, weightedMinor: 50_000_000 } };
  });

  it('shows pipeline value and moves deals between stages, asking why when lost', async () => {
    render(<DealBoard permissions={PM} />);
    const value = screen.getByRole('region', { name: 'Pipeline value' });
    expect(value).toHaveTextContent('NGN pipeline · 1 open deal');
    expect(value).toHaveTextContent('Weighted');

    const move = screen.getByLabelText('Move E-commerce rebuild');
    expect(within(move).getByRole('option', { name: 'Won (arrives with Projects)' })).toBeDisabled();
    await userEvent.selectOptions(move, 's_prop');
    expect(state.mutations['deals.moveToStage']).toHaveBeenCalledWith({ dealId: 'd1', stageId: 's_prop' });

    await userEvent.selectOptions(move, 's_lost');
    const dialog = await screen.findByRole('alertdialog', { name: 'Mark E-commerce rebuild as lost?' });
    expect(within(dialog).getByRole('button', { name: 'Mark as lost' })).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'r_budget');
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'Half the budget');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as lost' }));
    await waitFor(() =>
      expect(state.mutations['deals.moveToStage']).toHaveBeenCalledWith({
        dealId: 'd1',
        stageId: 's_lost',
        lostReasonId: 'r_budget',
        lostNote: 'Half the budget',
      }),
    );

    await userEvent.selectOptions(screen.getByLabelText('Owner'), 'mine');
    expect(state.queryArgs['deals.board']).toEqual({ ownerMemberId: 'mtobi' });
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table', { name: 'Deals' })).toHaveTextContent('E-commerce rebuild');
  });

  it('shows the board without moving or creating deals to deals.view alone', () => {
    render(<DealBoard permissions={FINANCE} />);
    expect(screen.queryByLabelText('Move E-commerce rebuild')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New deal' })).not.toBeInTheDocument();
  });
});

describe('DealDetail', () => {
  it('sets a follow-up and moves the deal from its page', async () => {
    state.queries['deals.get'] = deal({ nextFollowUpDate: undefined });
    render(<DealDetail dealId={'d1' as never} permissions={PM} />);
    expect(screen.getByRole('link', { name: 'Glossup' })).toHaveAttribute('href', '/crm/clients/c1');
    expect(state.queryArgs['activities.list']).toEqual({ subject: { table: 'deals', id: 'd1' } });

    await userEvent.type(screen.getByLabelText('Follow-up date'), '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Set' }));
    expect(state.mutations['deals.setFollowUp']).toHaveBeenCalledWith({ dealId: 'd1', date: '2026-10-01' });
    expect(await screen.findByText('Follow-up set for 1 Oct 2026.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Stage'), 's_prop');
    expect(state.mutations['deals.moveToStage']).toHaveBeenCalledWith({ dealId: 'd1', stageId: 's_prop' });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('ClientDeals', () => {
  it('lists a client’s deals and creates one for that client', async () => {
    state.queries['deals.list'] = [deal()];
    state.mutations['deals.create'] = vi.fn().mockResolvedValue('d2');
    render(<ClientDeals clientId={'c1' as never} permissions={PM} />);
    expect(state.queryArgs['deals.list']).toEqual({ clientId: 'c1', status: 'open' });
    expect(screen.getByRole('link', { name: 'E-commerce rebuild' })).toHaveAttribute('href', '/crm/deals/d1');

    await userEvent.click(screen.getByRole('button', { name: 'New deal' }));
    const dialog = await screen.findByRole('dialog', { name: 'New deal' });
    expect(within(dialog).queryByLabelText('Client')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Retainer 2027');
    await userEvent.type(within(dialog).getByLabelText('Value'), '1200.50');
    await userEvent.selectOptions(within(dialog).getByLabelText('Currency'), 'USD');
    await userEvent.type(within(dialog).getByLabelText('Win %'), '40');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create deal' }));
    await waitFor(() =>
      expect(state.mutations['deals.create']).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'c1',
          title: 'Retainer 2027',
          valueMinor: 120_050,
          currency: 'USD',
          probabilityBps: 4000,
        }),
      ),
    );
    expect(state.push).toHaveBeenCalledWith('/crm/deals/d2');
  });
});

describe('PipelineSettings', () => {
  it('adds, reorders and edits stages and retires lost reasons', async () => {
    state.queries['pipeline.lostReasons'] = [
      { id: 'r_budget', label: 'Budget', active: true },
      { id: 'r_timing', label: 'Timing', active: true },
    ];
    render(<PipelineSettings />);

    const add = screen.getByRole('form', { name: 'Add a stage' });
    await userEvent.type(within(add).getByLabelText('New stage'), 'Qualified');
    await userEvent.type(within(add).getByLabelText('Win %'), '15');
    await userEvent.click(within(add).getByRole('button', { name: 'Add stage' }));
    await waitFor(() =>
      expect(state.mutations['pipeline.createStage']).toHaveBeenCalledWith({ name: 'Qualified', probabilityBps: 1500 }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Move Proposal sent up' }));
    expect(state.mutations['pipeline.reorderStages']).toHaveBeenCalledWith({ openStageIds: ['s_prop', 's_new'] });

    const won = screen.getByRole('listitem', { name: 'Won' });
    expect(within(won).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    const newStage = screen.getByRole('listitem', { name: 'New' });
    const probability = within(newStage).getByLabelText('Win %');
    await userEvent.clear(probability);
    await userEvent.type(probability, '12.5');
    await userEvent.click(within(newStage).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.mutations['pipeline.updateStage']).toHaveBeenCalledWith({
        stageId: 's_new',
        name: 'New',
        probabilityBps: 1250,
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Retire Timing' }));
    expect(state.mutations['pipeline.setLostReasonActive']).toHaveBeenCalledWith({
      reasonId: 'r_timing',
      active: false,
    });
  });
});
