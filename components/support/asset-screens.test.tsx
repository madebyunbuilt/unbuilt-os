import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetDetail } from './asset-detail';
import { AssetList } from './asset-list';

// The renewal screens (09-support-and-sla.md). A lapsed domain takes a client's site with it, so the screen has to be
// loudest about exactly that, and must never guess a renewal term on somebody's behalf.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  push: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue(undefined);
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/support/assets',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return { api: Object.fromEntries(['assets', 'clients', 'projects'].map((n) => [n, functions(n)])) };
});

const asset = (overrides: object = {}) => ({
  id: 'a1',
  clientId: 'c1',
  clientName: 'Glossup',
  projectId: undefined,
  type: 'domain',
  name: 'glossup.com',
  provider: 'Namecheap',
  renewsOnDate: '2026-12-01',
  daysUntilRenewal: 30,
  costMinor: 15_00,
  costCurrency: 'USD',
  billPriceMinor: 30_000_00,
  billCurrency: 'NGN',
  autoInvoice: true,
  renewalInvoiceId: undefined,
  status: 'active',
  notes: undefined,
  remindersSent: [60],
  suggestedNextDate: '2027-12-01',
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'assets.list': [asset()],
    'assets.get': asset(),
    'clients.list': [{ id: 'c1', displayName: 'Glossup' }],
    'projects.list': [],
  };
  state.mutations = {};
  state.push.mockClear();
});

describe('the renewals list', () => {
  it('shows what the client pays and how near it is', () => {
    render(<AssetList />);
    expect(screen.getByText('₦30,000.00')).toBeInTheDocument();
    expect(screen.getByText('Renews in 30 days')).toBeInTheDocument();
  });

  it('is loudest about something that has already lapsed', () => {
    state.queries['assets.list'] = [asset({ daysUntilRenewal: -3 })];
    render(<AssetList />);
    expect(screen.getByText('Lapsed 3 days ago')).toBeInTheDocument();
  });

  it('says an asset handed over is no longer the studio’s', () => {
    state.queries['assets.list'] = [asset({ status: 'transferred', daysUntilRenewal: -40 })];
    render(<AssetList />);
    expect(screen.getByText('Theirs now')).toBeInTheDocument();
  });
});

describe('one renewal', () => {
  it('keeps what it costs apart from what the client pays', () => {
    render(<AssetDetail assetId={'a1' as never} />);
    expect(screen.getByText('$15.00')).toBeInTheDocument();
    expect(screen.getByText('₦30,000.00')).toBeInTheDocument();
  });

  it('says plainly when the studio does not bill it on', () => {
    state.queries['assets.get'] = asset({ billPriceMinor: undefined, billCurrency: undefined, autoInvoice: false });
    render(<AssetDetail assetId={'a1' as never} />);
    expect(screen.getByText('Not billed on')).toBeInTheDocument();
  });

  it('suggests a year but says to change it, rather than assuming the term', async () => {
    render(<AssetDetail assetId={'a1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'It has been renewed' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText('Next renewal')).toHaveValue('2027-12-01');
    expect(dialog.getByText(/Change it if this one runs for a month/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Save the new date' }));
    await waitFor(() =>
      expect(state.mutations['assets.markRenewed']).toHaveBeenCalledWith({
        assetId: 'a1',
        nextRenewsOnDate: '2027-12-01',
      }),
    );
  });

  it('says what handing it over stops', async () => {
    render(<AssetDetail assetId={'a1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hand it to the client' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/stops watching the date and stops reminding anybody/)).toBeInTheDocument();
  });

  it('warns while it is lapsed, and says who is being told', () => {
    state.queries['assets.get'] = asset({ daysUntilRenewal: -2 });
    render(<AssetDetail assetId={'a1' as never} />);
    expect(screen.getByText(/telling the admins daily until somebody does/)).toBeInTheDocument();
  });

  it('points at the invoice once one has been drafted', () => {
    state.queries['assets.get'] = asset({ renewalInvoiceId: 'inv1' });
    render(<AssetDetail assetId={'a1' as never} />);
    expect(screen.getByRole('link', { name: 'Check it and send it' })).toHaveAttribute(
      'href',
      '/billing/invoices/inv1',
    );
  });

  it('offers nothing to do with one that is no longer the studio’s', () => {
    state.queries['assets.get'] = asset({ status: 'transferred' });
    render(<AssetDetail assetId={'a1' as never} />);
    expect(screen.queryByRole('button', { name: 'It has been renewed' })).not.toBeInTheDocument();
    expect(screen.getByText(/belongs to the client now/)).toBeInTheDocument();
  });

  it('will not offer to draft an invoice with no price to invoice', async () => {
    state.queries['assets.get'] = asset({ billPriceMinor: undefined, billCurrency: undefined, autoInvoice: false });
    render(<AssetDetail assetId={'a1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText('Draft the invoice for me')).toBeDisabled();
    expect(dialog.getByText(/Give a price the client pays/)).toBeInTheDocument();
  });
});
