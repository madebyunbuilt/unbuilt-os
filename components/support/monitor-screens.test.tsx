import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorDetail } from './monitor-detail';
import { MonitorList } from './monitor-list';

// The monitor screens (09-support-and-sla.md). What is down comes first, and a monitor that has never been checked
// never reads as healthy.

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
  usePathname: () => '/support/monitors',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return { api: Object.fromEntries(['monitors', 'clients', 'projects'].map((n) => [n, functions(n)])) };
});

const NOW = Date.parse('2026-10-12T12:00:00Z');

const monitor = (overrides: object = {}) => ({
  id: 'm1',
  clientId: 'c1',
  clientName: 'Glossup',
  projectId: undefined,
  name: 'Glossup checkout',
  url: 'https://glossup.example.com/checkout',
  method: 'GET',
  expectedStatus: 200,
  intervalMinutes: 5,
  timeoutMs: 10_000,
  production: true,
  status: 'up',
  lastCheckedAt: NOW - 60_000,
  lastStatusCode: 200,
  consecutiveFailures: 0,
  ...overrides,
});

const detail = (overrides: object = {}) => ({
  ...monitor(),
  uptimeBps: 9990,
  checksInWindow: 8640,
  checks: [{ id: 'k1', checkedAt: NOW - 60_000, ok: true, statusCode: 200, latencyMs: 120, error: undefined }],
  incidents: [],
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  state.queries = {
    'monitors.list': [monitor()],
    'monitors.get': detail(),
    'clients.list': [{ id: 'c1', displayName: 'Glossup' }],
    'projects.list': [],
  };
  state.mutations = {};
  state.push.mockClear();
});

describe('the monitor list', () => {
  it('puts what is down at the top, whatever it is called', () => {
    state.queries['monitors.list'] = [
      monitor({ id: 'a', name: 'Aaa site', status: 'up' }),
      monitor({ id: 'z', name: 'Zzz site', status: 'down' }),
    ];
    render(<MonitorList />);
    expect(screen.getAllByRole('link')[0]).toHaveTextContent('Zzz site');
  });

  it('says when it was last checked, in words', () => {
    state.queries['monitors.list'] = [monitor({ lastCheckedAt: NOW - 12 * 60_000 })];
    render(<MonitorList />);
    expect(screen.getByText(/Checked 12 minutes ago/)).toBeInTheDocument();
  });

  it('says just now for a check that has only just happened', () => {
    render(<MonitorList />);
    expect(screen.getByText(/Checked just now/)).toBeInTheDocument();
  });

  it('says what a live site means before one is added', async () => {
    render(<MonitorList />);
    await userEvent.click(screen.getByRole('button', { name: 'Watch a URL' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/raises a P1 and messages the admins/)).toBeInTheDocument();
  });
});

describe('one monitor', () => {
  it('shows uptime to two decimals near the top, where the difference matters', () => {
    render(<MonitorDetail monitorId={'m1' as never} />);
    expect(screen.getByText('99.90%')).toBeInTheDocument();
  });

  it('does not call an unchecked monitor perfect', () => {
    state.queries['monitors.get'] = detail({
      uptimeBps: undefined,
      checksInWindow: 0,
      checks: [],
      status: 'paused',
      lastCheckedAt: undefined,
    });
    render(<MonitorDetail monitorId={'m1' as never} />);
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
    expect(screen.getByText('never')).toBeInTheDocument();
  });

  it('offers to start a paused one, and to stop a running one', async () => {
    render(<MonitorDetail monitorId={'m1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop checking' }));
    await waitFor(() =>
      expect(state.mutations['monitors.setPaused']).toHaveBeenCalledWith({ monitorId: 'm1', paused: true }),
    );
  });

  it('links an incident to the ticket that carries the work', () => {
    state.queries['monitors.get'] = detail({
      incidents: [
        {
          id: 'i1',
          startedAt: NOW - 3 * 60 * 60_000,
          resolvedAt: NOW - 2 * 60 * 60_000,
          ticketId: 't1',
          summary: 'Glossup checkout timed out',
        },
      ],
    });
    render(<MonitorDetail monitorId={'m1' as never} />);
    expect(screen.getByRole('link', { name: 'Its ticket' })).toHaveAttribute('href', '/support/tickets/t1');
    expect(screen.getByText(/back after 60 min/)).toBeInTheDocument();
  });

  it('says an incident is still running rather than leaving it blank', () => {
    state.queries['monitors.get'] = detail({
      status: 'down',
      incidents: [{ id: 'i1', startedAt: NOW - 600_000, resolvedAt: undefined, ticketId: 't1', summary: 'Down' }],
    });
    render(<MonitorDetail monitorId={'m1' as never} />);
    expect(screen.getByText(/still down/)).toBeInTheDocument();
  });

  it('warns what removing takes with it', async () => {
    render(<MonitorDetail monitorId={'m1' as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/check history goes too. Any tickets it raised stay/)).toBeInTheDocument();
  });

  it('says a monitor is not here rather than failing the page', () => {
    state.queries['monitors.get'] = null;
    render(<MonitorDetail monitorId={'gone' as never} />);
    expect(screen.getByText('That monitor is not here.')).toBeInTheDocument();
  });
});
