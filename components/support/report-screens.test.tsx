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
  uptime: [],
  incidents: [],
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

  it('shows what stayed up, against what was promised', () => {
    state.queries['slaReports.get'] = report({
      monitoring: undefined,
      uptime: [
        {
          monitorId: 'm1',
          name: 'Glossup checkout',
          url: 'https://glossup.example.com/checkout',
          checks: 8640,
          passed: 8631,
          uptimeBps: 9990,
          targetBps: 9950,
        },
      ],
    });
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText('99.90%')).toBeInTheDocument();
    expect(screen.getByText('Met 99.50%')).toBeInTheDocument();
  });

  it('says when a monitor fell under what was promised', () => {
    state.queries['slaReports.get'] = report({
      monitoring: undefined,
      uptime: [
        {
          monitorId: 'm1',
          name: 'Glossup checkout',
          url: 'https://glossup.example.com/checkout',
          checks: 8640,
          passed: 8200,
          uptimeBps: 9490,
          targetBps: 9950,
        },
      ],
    });
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText('Under 99.50%')).toBeInTheDocument();
  });

  it('does not judge a monitor against a target nobody set', () => {
    state.queries['slaReports.get'] = report({
      monitoring: undefined,
      uptime: [
        {
          monitorId: 'm1',
          name: 'Glossup checkout',
          url: 'https://glossup.example.com/checkout',
          checks: 10,
          passed: 10,
          uptimeBps: 10_000,
          targetBps: undefined,
        },
      ],
    });
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText('None set')).toBeInTheDocument();
  });

  it('lists the month’s incidents with the ticket each raised', () => {
    state.queries['slaReports.get'] = report({
      monitoring: undefined,
      uptime: [],
      incidents: [
        {
          monitorName: 'Glossup checkout',
          startedAt: Date.parse('2026-10-08T13:00:00Z'),
          resolvedAt: Date.parse('2026-10-08T13:30:00Z'),
          downMinutes: 30,
          ticketNumber: 'UNB-TKT-0004',
          summary: 'Glossup checkout timed out',
        },
      ],
    });
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText('Glossup checkout timed out')).toBeInTheDocument();
    expect(screen.getByText(/down for 30 minutes · UNB-TKT-0004/)).toBeInTheDocument();
  });

  it('says an incident was still running at the end of the month', () => {
    state.queries['slaReports.get'] = report({
      monitoring: undefined,
      uptime: [],
      incidents: [
        {
          monitorName: 'Glossup checkout',
          startedAt: Date.parse('2026-10-30T13:00:00Z'),
          resolvedAt: undefined,
          downMinutes: 2_000,
          ticketNumber: undefined,
          summary: 'Glossup checkout timed out',
        },
      ],
    });
    render(<ReportDetail reportId={'r1' as never} />);
    expect(screen.getByText(/still down at the end of the month/)).toBeInTheDocument();
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
