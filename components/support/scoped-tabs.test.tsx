import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientAssets } from './client-assets';
import { ClientTickets, ProjectTickets } from './scoped-tickets';
import { CLIENT_TABS } from '@/components/crm/client-header';
import { PROJECT_TABS } from '@/components/projects/project-header';

// Tickets and renewals on the page somebody is already looking at (05-crm.md, 06-projects.md). These tabs were
// marked "not built yet" for several steps after their modules landed; the tests here are what stops that recurring.

const state = vi.hoisted(() => ({ queries: {} as Record<string, unknown> }));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: () => vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return { api: Object.fromEntries(['tickets', 'assets', 'clients', 'projects'].map((n) => [n, functions(n)])) };
});

const NOW = Date.parse('2026-10-12T12:00:00Z');

const ticket = (overrides: object = {}) => ({
  id: 't1',
  number: 'UNB-TKT-0001',
  subject: 'Checkout is down',
  priority: 'p1',
  status: 'new',
  createdAt: NOW - 3_600_000,
  firstResponseDueAt: NOW + 600_000,
  resolutionDueAt: NOW + 3_600_000,
  firstRespondedAt: undefined,
  resolvedAt: undefined,
  closedAt: undefined,
  pausedAt: undefined,
  hasSla: true,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  state.queries = {
    'tickets.forClient': [ticket()],
    'tickets.list': [ticket({ id: 't2', number: 'UNB-TKT-0002', subject: 'Staging is slow' })],
    'assets.list': [
      {
        id: 'a1',
        type: 'domain',
        name: 'glossup.com',
        provider: 'Namecheap',
        renewsOnDate: '2026-12-01',
        daysUntilRenewal: 50,
        billPriceMinor: 30_000_00,
        billCurrency: 'NGN',
        status: 'active',
      },
    ],
  };
});

describe('the tabs that were dead ends', () => {
  it('shows a client their own tickets, linked to the support page', () => {
    render(<ClientTickets clientId={'c1' as never} />);
    expect(screen.getByRole('link', { name: /Checkout is down/ })).toHaveAttribute('href', '/support/tickets/t1');
    // With the same urgency wording the support list uses, not a second vocabulary.
    expect(screen.getByText('Reply due in 10 minutes')).toBeInTheDocument();
  });

  it('shows a project its own tickets', () => {
    render(<ProjectTickets projectId={'p1' as never} />);
    expect(screen.getByText('Staging is slow')).toBeInTheDocument();
  });

  it('says so plainly when there are none', () => {
    state.queries['tickets.forClient'] = [];
    render(<ClientTickets clientId={'c1' as never} />);
    expect(screen.getByText(/No tickets here/)).toBeInTheDocument();
  });

  it('shows what Unbuilt renews for a client, handed-over ones included', () => {
    render(<ClientAssets clientId={'c1' as never} />);
    expect(screen.getByText('glossup.com')).toBeInTheDocument();
    expect(screen.getByText('Renews in 50 days')).toBeInTheDocument();
  });
});

describe('the tab flags', () => {
  it('no longer calls tickets or assets unbuilt, because they are', () => {
    const client = new Map(CLIENT_TABS.map((tab) => [tab.segment, tab]));
    expect(client.get('tickets')?.built).toBe(true);
    expect(client.get('assets')?.built).toBe(true);
    expect(new Map(PROJECT_TABS.map((tab) => [tab.segment, tab])).get('tickets')?.built).toBe(true);
  });

  it('still says so about the ones that genuinely are not built', () => {
    // Vault is step 13; Files, Updates and Handover have no page. Marking them built would be the worse lie.
    const client = new Map(CLIENT_TABS.map((tab) => [tab.segment, tab]));
    expect(client.get('vault')?.built).toBe(false);
    expect(client.get('files')?.built).toBe(false);
    const project = new Map(PROJECT_TABS.map((tab) => [tab.segment, tab]));
    expect(project.get('updates')?.built).toBe(false);
    expect(project.get('handover')?.built).toBe(false);
  });
});
