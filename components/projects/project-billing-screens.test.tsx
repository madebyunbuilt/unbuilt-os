import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeRequestsPanel } from './change-requests-panel';
import { ProjectBillingPanel } from './project-billing-panel';

// How a project is billed, on screen (06-projects.md and 08-billing-and-finance.md): the schedule that must add up
// before it can be turned on, the retainer's hours, and a change request saying what approving it will do.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue({ ok: true });
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/invoices',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(
      ['billingSchedules', 'retainers', 'invoices', 'projects', 'changeRequests', 'contacts'].map((name) => [
        name,
        functions(name),
      ]),
    ),
  };
});

const FINANCE = ['invoices.view', 'schedules.manage', 'retainers.manage'];
const PM = ['changerequests.create', 'changerequests.send'];

const schedule = (overrides: object = {}) => ({
  id: 's1',
  projectId: 'p1',
  clientId: 'c1',
  contractDocumentId: undefined,
  currency: 'NGN',
  status: 'draft',
  amountMinor: 1_000_000_00,
  scheduledMinor: 1_000_000_00,
  autoSend: false,
  items: [
    {
      id: 'i1',
      label: 'On signature',
      kind: 'percent',
      bps: 5_000,
      amountMinor: 500_000_00,
      trigger: 'on_signature',
      status: 'pending',
    },
    {
      id: 'i2',
      label: 'On final approval',
      kind: 'percent',
      bps: 5_000,
      amountMinor: 500_000_00,
      trigger: 'on_milestone_approved',
      status: 'pending',
    },
  ],
  ...overrides,
});

const changeRequest = (overrides: object = {}) => ({
  id: 'cr1',
  number: undefined,
  projectId: 'p1',
  clientId: 'c1',
  title: 'A second onboarding screen',
  description: 'One more screen in the onboarding flow.',
  reason: 'The client added a step after user testing.',
  impact: { amountMinor: 200_000_00, currency: 'NGN', days: 5 },
  billing: 'invoice_now',
  status: 'draft',
  needsSignature: undefined,
  documentId: undefined,
  decidedAt: undefined,
  declineReason: undefined,
  invoiceId: undefined,
  appliedAt: undefined,
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'billingSchedules.forProject': null,
    'retainers.forProject': null,
    'invoices.list': [],
    'projects.get': { id: 'p1', clientId: 'c1', name: 'Glossup app' },
    'changeRequests.listForProject': [],
    'contacts.listForClient': [{ id: 'ct1', name: 'Ada Obi', status: 'active' }],
  };
  state.mutations = {};
});

describe('the billing schedule on a project', () => {
  it('offers the studio’s usual split when there is none yet', async () => {
    render(<ProjectBillingPanel projectId={'p1' as never} permissions={FINANCE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up a schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up a billing schedule' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set it up' }));

    await waitFor(() =>
      expect(state.mutations['billingSchedules.create']).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p1',
          items: [
            expect.objectContaining({ label: 'On signature', bps: 5_000, trigger: 'on_signature' }),
            expect.objectContaining({ label: 'On final approval', trigger: 'on_milestone_approved' }),
          ],
        }),
      ),
    );
  });

  it('will not turn on until the parts add up, and says by how much', () => {
    state.queries['billingSchedules.forProject'] = schedule({ scheduledMinor: 400_000_00 });
    render(<ProjectBillingPanel projectId={'p1' as never} permissions={FINANCE} />);
    expect(screen.getByRole('button', { name: 'Turn it on' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('₦400,000.00');
    expect(screen.getByRole('status')).toHaveTextContent('₦1,000,000.00');
  });

  it('turns on once they match', async () => {
    state.queries['billingSchedules.forProject'] = schedule();
    render(<ProjectBillingPanel projectId={'p1' as never} permissions={FINANCE} />);
    const button = screen.getByRole('button', { name: 'Turn it on' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() =>
      expect(state.mutations['billingSchedules.activate']).toHaveBeenCalledWith({ scheduleId: 's1' }),
    );
  });

  it('offers invoicing a part early only while the schedule is on and the part is waiting', () => {
    state.queries['billingSchedules.forProject'] = schedule({
      status: 'active',
      items: [{ ...schedule().items[0], status: 'invoiced', invoiceId: 'inv1' }, schedule().items[1]],
    });
    render(<ProjectBillingPanel projectId={'p1' as never} permissions={FINANCE} />);
    // One part is already invoiced and links to it; the other can still be raised early.
    expect(screen.getByRole('link', { name: 'Invoice' })).toHaveAttribute('href', '/billing/invoices/inv1');
    expect(screen.getAllByRole('button', { name: 'Invoice now' })).toHaveLength(1);
  });

  it('shows nothing to set up for a viewer who cannot manage one', () => {
    render(<ProjectBillingPanel projectId={'p1' as never} permissions={['invoices.view']} />);
    expect(screen.queryByRole('button', { name: 'Set up a schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up a retainer' })).not.toBeInTheDocument();
  });
});

describe('the retainer on a project', () => {
  it('says where the hours stand, counting what was carried in', () => {
    state.queries['retainers.forProject'] = {
      id: 'r1',
      clientId: 'c1',
      projectId: 'p1',
      currency: 'NGN',
      monthlyFeeMinor: 500_000_00,
      includedMinutes: 600,
      overageRateMinor: 25_000_00,
      invoiceDayOfMonth: 1,
      startDate: '2026-10-01',
      endDate: undefined,
      status: 'active',
      autoSend: false,
      rolloverUnusedMinutes: true,
      current: {
        id: 'rp1',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        includedMinutes: 600,
        rolloverMinutes: 120,
        usedMinutes: 300,
        remainingMinutes: 420,
        overageMinutes: 0,
        usageBps: 4_167,
        invoiceId: 'inv2',
        overageInvoiceId: undefined,
        closedAt: undefined,
      },
      past: [],
    };
    render(<ProjectBillingPanel projectId={'p1' as never} permissions={FINANCE} />);
    expect(screen.getByText(/5 of 12 hours used/)).toBeInTheDocument();
    expect(screen.getByText(/2 carried in/)).toBeInTheDocument();
    expect(screen.getByText(/7 left/)).toBeInTheDocument();
  });
});

describe('change requests on a project', () => {
  it('creates one with what it adds in money and days', async () => {
    render(<ChangeRequestsPanel projectId={'p1' as never} permissions={PM} />);
    await userEvent.click(screen.getByRole('button', { name: 'New change request' }));
    const dialog = await screen.findByRole('dialog', { name: 'New change request' });

    await userEvent.type(within(dialog).getByLabelText('What is changing'), 'A second onboarding screen');
    await userEvent.type(within(dialog).getByLabelText('In full, for the client'), 'One more screen.');
    await userEvent.type(within(dialog).getByLabelText('Why it is needed'), 'User testing.');
    await userEvent.type(within(dialog).getByLabelText(/What it adds/), '200000');
    await userEvent.clear(within(dialog).getByLabelText('Days it adds'));
    await userEvent.type(within(dialog).getByLabelText('Days it adds'), '5');
    await userEvent.selectOptions(within(dialog).getByLabelText('How it is billed'), 'with_the_schedule');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(state.mutations['changeRequests.create']).toHaveBeenCalledWith({
        projectId: 'p1',
        title: 'A second onboarding screen',
        description: 'One more screen.',
        reason: 'User testing.',
        amountMinor: 20_000_000,
        days: 5,
        billing: 'with_the_schedule',
      }),
    );
  });

  it('offers recording a decision only while it is with the client, and not when it must be signed', () => {
    state.queries['changeRequests.listForProject'] = [changeRequest({ status: 'sent', needsSignature: false })];
    render(<ChangeRequestsPanel projectId={'p1' as never} permissions={PM} />);
    expect(screen.getByRole('button', { name: 'They approved it' })).toBeInTheDocument();

    state.queries['changeRequests.listForProject'] = [
      changeRequest({ status: 'sent', needsSignature: true, documentId: 'd1' }),
    ];
    render(<ChangeRequestsPanel projectId={'p1' as never} permissions={PM} />);
    // Above the threshold the signature is the approval, so there is nothing to record by hand.
    expect(screen.getAllByRole('button', { name: 'They approved it' })).toHaveLength(1);
    expect(screen.getByText(/approved by the client signing it/)).toBeInTheDocument();
  });

  it('links to the invoice an approved one raised', () => {
    state.queries['changeRequests.listForProject'] = [
      changeRequest({ status: 'approved', number: 'UNB-CR-0001', invoiceId: 'inv3' }),
    ];
    render(<ChangeRequestsPanel projectId={'p1' as never} permissions={PM} />);
    expect(screen.getByRole('link', { name: 'See the invoice it raised' })).toHaveAttribute(
      'href',
      '/billing/invoices/inv3',
    );
  });

  it('says when an approved one went to the billing schedule instead', () => {
    state.queries['changeRequests.listForProject'] = [
      changeRequest({ status: 'approved', number: 'UNB-CR-0001', billing: 'with_the_schedule' }),
    ];
    render(<ChangeRequestsPanel projectId={'p1' as never} permissions={PM} />);
    expect(screen.getByText('Added to the project’s billing schedule.')).toBeInTheDocument();
  });
});
