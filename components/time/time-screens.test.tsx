import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderTimer } from '@/components/app/shell/header-timer';
import { ProjectTimePanel } from '@/components/projects/project-time-panel';
import { TimeApprovals } from './approvals';
import { Timesheet } from './timesheet';

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/time',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return { api: Object.fromEntries(['time', 'tasks', 'projects'].map((name) => [name, functions(name)])) };
});

const entry = (overrides: object = {}) => ({
  id: 'e1',
  memberId: 'm_tobi',
  memberName: 'Tobi Ade',
  projectId: 'p1',
  projectCode: 'UNB-P-0007',
  projectName: 'Glossup app',
  taskId: undefined,
  taskTitle: undefined,
  date: '2026-09-15',
  weekStart: '2026-09-14',
  minutes: 90,
  description: 'Booking flow',
  billable: true,
  status: 'draft',
  returnedNote: undefined,
  approvedByName: undefined,
  approvedAt: undefined,
  missingRates: false,
  canEdit: true,
  canDecide: false,
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'time.myWeek': {
      weekStart: '2026-09-14',
      today: '2026-09-15',
      totals: { minutes: 90, billableMinutes: 90, draft: 1 },
      entries: [entry()],
    },
    'time.myRecentProjects': [{ id: 'p1', code: 'UNB-P-0007', name: 'Glossup app' }],
    'tasks.listForProject': [{ id: 't1', title: 'Wire up the booking flow' }],
  };
  state.queryArgs = {};
  state.mutations = {};
});

describe('Timesheet', () => {
  it('shows the week, logs time and submits the drafts', async () => {
    render(<Timesheet />);

    expect(screen.getByText('14–20 Sep 2026')).toBeInTheDocument();
    expect(screen.getByText('1h 30m logged · 1h 30m billable')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Tuesday' })).toHaveTextContent('Booking flow');

    await userEvent.click(screen.getByRole('button', { name: 'The week before' }));
    await waitFor(() => expect(state.queryArgs['time.myWeek']).toEqual({ weekStart: '2026-09-07' }));

    await userEvent.click(screen.getAllByRole('button', { name: /^Log time/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Log time' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Project'), 'p1');
    await userEvent.selectOptions(within(dialog).getByLabelText('Task (optional)'), 't1');
    await userEvent.type(within(dialog).getByLabelText('How long'), '1:45');
    await userEvent.type(within(dialog).getByLabelText('What you did'), 'Payments');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log time' }));
    await waitFor(() =>
      expect(state.mutations['time.log']).toHaveBeenCalledWith({
        projectId: 'p1',
        taskId: 't1',
        date: '2026-09-15',
        minutes: 105,
        description: 'Payments',
        billable: true,
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Submit 1 entry' }));
    await waitFor(() => expect(state.mutations['time.submitWeek']).toHaveBeenCalledWith({ weekStart: '2026-09-14' }));
  });

  it('shows what an approver sent back and offers no submit without drafts', () => {
    state.queries['time.myWeek'] = {
      weekStart: '2026-09-14',
      today: '2026-09-15',
      totals: { minutes: 90, billableMinutes: 0, draft: 0 },
      entries: [entry({ status: 'submitted', billable: false, canEdit: false, returnedNote: 'Split this by task' })],
    };
    render(<Timesheet />);
    expect(screen.getByText('Sent back to you')).toBeInTheDocument();
    expect(screen.getByText(/Split this by task/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Submit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('refuses time that is not a number', async () => {
    render(<Timesheet />);
    await userEvent.click(screen.getAllByRole('button', { name: /^Log time/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Log time' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Project'), 'p1');
    await userEvent.type(within(dialog).getByLabelText('How long'), 'a while');
    await userEvent.type(within(dialog).getByLabelText('What you did'), 'Thinking');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log time' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('how long');
    expect(state.mutations['time.log']).not.toHaveBeenCalled();
  });
});

describe('HeaderTimer', () => {
  it('starts a timer on a project and a task', async () => {
    state.queries['time.runningTimer'] = null;
    render(<HeaderTimer />);

    await userEvent.click(screen.getByRole('button', { name: 'Start a timer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a timer' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Project'), 'p1');
    await userEvent.selectOptions(within(dialog).getByLabelText('Task (optional)'), 't1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(state.mutations['time.startTimer']).toHaveBeenCalledWith({
        projectId: 'p1',
        taskId: 't1',
        description: undefined,
      }),
    );
  });

  it('shows what is running, stops it, and can throw it away', async () => {
    state.queries['time.runningTimer'] = {
      projectId: 'p1',
      projectName: 'Glossup app',
      taskId: undefined,
      taskTitle: undefined,
      description: 'Booking flow',
      startedAt: Date.now() - 45 * 60_000,
    };
    render(<HeaderTimer />);

    const running = screen.getByRole('button', { name: /Stop the timer on Glossup app/ });
    expect(running).toHaveTextContent('45m');
    await userEvent.click(running);

    const dialog = await screen.findByRole('dialog', { name: 'Stop the timer' });
    expect(dialog).toHaveTextContent('45m on Glossup app');
    await userEvent.click(within(dialog).getByLabelText('Billable to the client'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop and keep' }));
    await waitFor(() =>
      expect(state.mutations['time.stopTimer']).toHaveBeenCalledWith({
        description: 'Booking flow',
        billable: false,
      }),
    );
  });

  it('shows nothing while the timer is still loading', () => {
    state.queries['time.runningTimer'] = undefined;
    const { container } = render(<HeaderTimer />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TimeApprovals', () => {
  const week = { memberId: 'mkemi', memberName: 'Kemi Bello', weekStart: '2026-09-14', minutes: 480, entries: 2 };

  beforeEach(() => {
    state.queries['time.pendingApprovals'] = [week];
    state.queries['time.weekForReview'] = [
      entry({ id: 'e1', memberName: 'Kemi Bello', status: 'submitted', canEdit: false, canDecide: true }),
      entry({
        id: 'e2',
        memberName: 'Kemi Bello',
        status: 'approved',
        minutes: 390,
        canEdit: false,
        canDecide: false,
      }),
    ];
  });

  it('approves the entries an approver picked', async () => {
    render(<TimeApprovals permissions={['time.approve']} />);
    expect(screen.getByText('Kemi Bello')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Look through it' }));
    const dialog = await screen.findByRole('dialog', { name: /Kemi Bello, 14–20 Sep 2026/ });
    // Only the submitted entry can be decided, so only that one counts.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve 1 entry' }));
    await waitFor(() => expect(state.mutations['time.approve']).toHaveBeenCalledWith({ entryIds: ['e1'] }));
  });

  it('asks for a note before sending a week back', async () => {
    render(<TimeApprovals permissions={['time.approve']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Look through it' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back with a note' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('what needs changing');
    expect(state.mutations['time.returnEntries']).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('What needs changing'), 'Split this by task');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    await waitFor(() =>
      expect(state.mutations['time.returnEntries']).toHaveBeenCalledWith({
        entryIds: ['e1'],
        note: 'Split this by task',
      }),
    );
  });

  it('lists weeks nobody has submitted for the Owner and Admins', () => {
    state.queries['time.outstandingWeeks'] = [
      { memberId: 'mzuri', memberName: 'Zuri Cole', weekStart: '2026-09-07', minutes: 120 },
    ];
    render(<TimeApprovals permissions={['time.approve', 'time.view.all']} />);
    expect(screen.getByText('Not submitted yet')).toBeInTheDocument();
    expect(screen.getByText('2h in drafts')).toBeInTheDocument();
  });
});

describe('ProjectTimePanel', () => {
  beforeEach(() => {
    state.queries['projects.get'] = { id: 'p1', status: 'active', currency: 'NGN', isMember: true, members: [] };
    state.queries['time.projectSummary'] = {
      scope: 'all',
      loggedMinutes: 90,
      billableMinutes: 90,
      approvedMinutes: 60,
      estimateMinutes: 600,
      missingRates: 1,
    };
    state.queries['time.listForProject'] = {
      scope: 'all',
      totals: { minutes: 90, billableMinutes: 90 },
      entries: [entry({ status: 'submitted', canEdit: false, missingRates: true })],
    };
  });

  it('shows everyone’s time with totals, and lets Finance fill in a missing rate', async () => {
    render(<ProjectTimePanel projectId={'p1' as never} permissions={['time.log.own', 'team.rates.sensitive']} />);

    expect(screen.getByText('Logged')).toBeInTheDocument();
    expect(screen.getAllByText('1h 30m').length).toBeGreaterThan(0);
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('1 entries have no rate')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add a rate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rates for this entry' });
    await userEvent.type(within(dialog).getByLabelText('Bill rate an hour'), '25000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rates' }));
    await waitFor(() =>
      expect(state.mutations['time.setEntryRates']).toHaveBeenCalledWith({
        entryId: 'e1',
        billRateMinor: 2_500_000,
        costRateMinor: undefined,
        currency: 'NGN',
      }),
    );
  });

  it('hides rates and says whose time it is without time.view.all', () => {
    state.queries['time.listForProject'] = {
      scope: 'own',
      totals: { minutes: 90, billableMinutes: 0 },
      entries: [entry()],
    };
    render(<ProjectTimePanel projectId={'p1' as never} permissions={['time.log.own']} />);
    expect(screen.getByText('My hours')).toBeInTheDocument();
    expect(screen.queryByText('Bill rate')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a rate' })).not.toBeInTheDocument();
  });
});
