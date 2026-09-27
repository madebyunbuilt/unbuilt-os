import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientOverview } from './client-overview';

// The About card on a client (05-crm.md). What it holds is typed by a person and read by a person, so a stored code
// is not what goes on the screen, and a long address does not get to push the card out of shape.

const state = vi.hoisted(() => ({ queries: {} as Record<string, unknown> }));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: () => vi.fn(),
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(
      ['clients', 'contacts', 'deals', 'activities', 'projects', 'invoices', 'tickets'].map((n) => [n, functions(n)]),
    ),
  };
});

const client = (overrides: object = {}) => ({
  id: 'c1',
  displayName: 'Glossup',
  status: 'active',
  website: 'https://codabytez.netlify.app',
  country: 'NG',
  source: 'referral',
  tags: ['new', 'special'],
  notes: 'special client',
  createdAt: Date.parse('2026-09-14T09:00:00Z'),
  defaultCurrency: 'NGN',
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'clients.get': client(),
    'contacts.listForClient': [
      { id: 'ct1', name: 'Jane Doe', email: 'codabytez+client1@gmail.com', isPrimary: true, status: 'active' },
    ],
    'deals.list': [],
    'activities.forSubject': [],
    'invoices.list': [],
    'projects.list': [],
    'tickets.forClient': [],
  };
});

describe('the About card', () => {
  it('names the country rather than showing the code somebody typed', () => {
    render(<ClientOverview clientId={'c1' as never} permissions={[]} />);
    expect(screen.getByText('Nigeria')).toBeInTheDocument();
    expect(screen.queryByText('NG')).not.toBeInTheDocument();
  });

  it('shows a typed source with a capital letter, and changes nothing else about it', () => {
    state.queries['clients.get'] = client({ source: 'referral from Bayo' });
    render(<ClientOverview clientId={'c1' as never} permissions={[]} />);
    expect(screen.getByText('Referral from Bayo')).toBeInTheDocument();
  });

  it('gives a long address its own line, so it cannot push the card out of shape', () => {
    render(<ClientOverview clientId={'c1' as never} permissions={[]} />);
    const email = screen.getByRole('link', { name: 'codabytez+client1@gmail.com' });
    // Its own element, breakable, and not run together with the name as one unbreakable string.
    expect(email).toHaveAttribute('href', 'mailto:codabytez+client1@gmail.com');
    expect(email.className).toContain('break-all');
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('counts what the client has, now the modules it waited for exist', () => {
    state.queries['invoices.list'] = [
      { id: 'i1', status: 'paid', currency: 'NGN', totals: { totalMinor: 500_000_00 }, balanceMinor: 0 },
      { id: 'i2', status: 'sent', currency: 'NGN', totals: { totalMinor: 200_000_00 }, balanceMinor: 200_000_00 },
      // A draft was never sent, so it is not revenue and not owed.
      { id: 'i3', status: 'draft', currency: 'NGN', totals: { totalMinor: 900_000_00 }, balanceMinor: 0 },
    ];
    state.queries['projects.list'] = [{ id: 'p1' }, { id: 'p2' }];
    state.queries['tickets.forClient'] = [{ id: 't1' }];
    render(
      <ClientOverview
        clientId={'c1' as never}
        permissions={['invoices.view', 'projects.view.all', 'tickets.view.all']}
      />,
    );
    expect(screen.getByText('₦700,000.00')).toBeInTheDocument();
    expect(screen.getByText('₦200,000.00')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('keeps two currencies apart rather than inventing a rate to add them', () => {
    state.queries['invoices.list'] = [
      { id: 'i1', status: 'paid', currency: 'NGN', totals: { totalMinor: 200_000_00 }, balanceMinor: 0 },
      { id: 'i2', status: 'paid', currency: 'USD', totals: { totalMinor: 2_000_00 }, balanceMinor: 0 },
    ];
    render(<ClientOverview clientId={'c1' as never} permissions={['invoices.view']} />);
    expect(screen.getByText('₦200,000.00 + $2,000.00')).toBeInTheDocument();
  });

  it('asks nothing about figures the viewer may not see', () => {
    render(<ClientOverview clientId={'c1' as never} permissions={[]} />);
    expect(screen.getAllByText('Invoices are not yours to see')).toHaveLength(2);
    expect(screen.getByText('Tickets are not yours to see')).toBeInTheDocument();
  });

  it('says so plainly when there is no primary contact', () => {
    state.queries['contacts.listForClient'] = [];
    render(<ClientOverview clientId={'c1' as never} permissions={[]} />);
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });
});
