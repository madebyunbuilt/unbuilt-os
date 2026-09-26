import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportDetail } from './report-detail';
import { ReportList } from './report-list';

// The SLA report screens (09-support-and-sla.md). A client reads these figures as a judgement on the studio, so the
// screen has to be exact about what it does and does not claim.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue(undefined);
    return state.mutations[ref._name];
  },
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return { api: Object.fromEntries(['slaReports', 'portalReports'].map((n) => [n, functions(n)])) };
});

const report = (overrides: object = {}) => ({
  id: 'r1',
  clientId: 'c1',
  clientName: 'Glossup',
  policyName: 'Standard',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  status: 'draft',
  byPriority: [
    { priority: 'p1', opened: 0, resolved: 0 },
    { priority: 'p2', opened: 2, resolved: 1, firstResponseComplianceBps: 5000, resolutionComplianceBps: 10_000 },
    { priority: 'p3', opened: 1, resolved: 1, firstResponseComplianceBps: 10_000 },
    { priority: 'p4', opened: 0, resolved: 0 },
  ],
  breaches: [],
  retainerMinutes: undefined,
  monitoring: 'not_monitored',
  generatedAt: Date.parse('2026-11-02T07:30:00Z'),
  sentAt: undefined,
  ...overrides,
});

beforeEach(() => {
  state.queries = { 'slaReports.get': report(), 'slaReports.list': [report()] };
  state.mutations = {};
});

describe('reading a month', () => {
  it('says a priority had nothing raised, rather than scoring it', () => {
    render(<ReportDetail reportId={'r1' as never} />);
    // Two P-rows had no tickets; neither may claim a perfect score.
    expect(screen.getAllByText('None raised').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('says plainly that nothing was missed', () => {
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText('Nothing was missed this month.')).toBeInTheDocument();
  });

  it('shows a missed target with how late it was and why', () => {
    state.queries['slaReports.get'] = report({
      breaches: [
        {
          ticketId: 't1',
          number: 'UNB-TKT-0001',
          subject: 'Checkout is down',
          priority: 'p2',
          target: 'firstResponse',
          lateMinutes: 300,
          reason: 'Raised during the release freeze.',
        },
      ],
    });
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText(/First reply · 5 hours late/)).toBeInTheDocument();
    expect(screen.getByText('Raised during the release freeze.')).toBeInTheDocument();
  });

  it('admits when no reason was given, rather than leaving a blank', () => {
    state.queries['slaReports.get'] = report({
      breaches: [
        {
          ticketId: 't1',
          number: 'UNB-TKT-0001',
          subject: 'Checkout is down',
          priority: 'p2',
          target: 'resolution',
          lateMinutes: 960,
          reason: undefined,
        },
      ],
    });
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText('No reason has been given for this one.')).toBeInTheDocument();
  });

  it('says nothing was monitored, instead of showing an empty uptime section', () => {
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText(/not monitoring anything for you this month/)).toBeInTheDocument();
  });
});

describe('sending it', () => {
  it('says the client has not seen it, and asks before sending', async () => {
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText(/The client has not seen this yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/Nothing here changes afterwards/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Send it' }));
    await waitFor(() => expect(state.mutations['slaReports.send']).toHaveBeenCalledWith({ reportId: 'r1' }));
  });

  it('offers no way to send one that has gone already', () => {
    state.queries['slaReports.get'] = report({ status: 'sent', sentAt: Date.parse('2026-11-03T09:00:00Z') });
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.queryByRole('button', { name: 'Send it' })).not.toBeInTheDocument();
    expect(screen.getByText(/Sent /)).toBeInTheDocument();
  });

  it('shows a draft as a client still waiting', () => {
    render(<ReportList />);
    const row = screen.getByRole('link');
    // The badge on the row, not the filter above it, which happens to use the same words.
    expect(within(row).getByText('Waiting to be sent')).toBeInTheDocument();
    expect(within(row).getByText(/October 2026 · nothing missed/)).toBeInTheDocument();
  });
});
