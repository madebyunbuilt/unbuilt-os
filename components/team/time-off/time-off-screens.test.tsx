import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessHoursForm } from '@/components/settings/business-hours-form';
import { HolidaysList } from '@/components/settings/holidays-list';
import { LeaveCalendar } from './leave-calendar';
import { TimeOffDialog } from './time-off-dialog';
import { TimeOffOverview } from './time-off-overview';

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
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: {
      timeOff: functions('timeOff'),
      team: functions('team'),
      holidays: functions('holidays'),
      businessHours: functions('businessHours'),
    },
  };
});

const entry = (overrides: object = {}) => ({
  id: 't1',
  memberId: 'm_dayo',
  memberName: 'Dayo Ade',
  startDate: '2026-09-30',
  endDate: '2026-10-02',
  halfDay: false,
  status: 'requested',
  days: 2,
  type: 'annual',
  note: 'Family wedding',
  canDecide: true,
  canCancel: true,
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'team.me': { id: 'm_kemi', name: 'Kemi Bello', role: { isOwner: false } },
    'timeOff.mine': { today: '2026-09-14', requests: [], upcomingHolidays: [] },
    'timeOff.calendar': { entries: [], holidays: [], workingWeekdays: [1, 2, 3, 4, 5] },
  };
  state.queryArgs = {};
  state.mutations = {};
});

describe('TimeOffDialog', () => {
  it('requests time off, offering a half day only for a single date', async () => {
    render(<TimeOffDialog today="2026-09-14" trigger={<button>Request time off</button>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Request time off' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request time off' });

    expect(within(dialog).getByLabelText('Half day')).toBeInTheDocument();
    const start = within(dialog).getByLabelText('First day');
    await userEvent.clear(start);
    await userEvent.type(start, '2026-09-30');
    // Moving the first day past the last day moves the last day with it.
    expect(within(dialog).getByLabelText('Last day')).toHaveValue('2026-09-30');
    const end = within(dialog).getByLabelText('Last day');
    await userEvent.clear(end);
    await userEvent.type(end, '2026-10-02');
    expect(within(dialog).queryByLabelText('Half day')).not.toBeInTheDocument();

    expect(within(dialog).getByRole('option', { name: 'Sick leave' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: 'Public holiday' })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'Family wedding');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));

    await waitFor(() =>
      expect(state.mutations['timeOff.request']).toHaveBeenCalledWith({
        type: 'annual',
        startDate: '2026-09-30',
        endDate: '2026-10-02',
        halfDay: false,
        note: 'Family wedding',
      }),
    );
  });

  it('records for a chosen member and shows why the server refused', async () => {
    render(
      <TimeOffDialog
        today="2026-09-14"
        members={[{ id: 'm_dayo' as never, name: 'Dayo Ade' }]}
        trigger={<button>Record for someone</button>}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Record for someone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record time off' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Record time off' }));
    expect(await within(dialog).findByText('Choose a team member')).toBeInTheDocument();

    state.mutations['timeOff.record'] = vi
      .fn()
      .mockRejectedValue(
        new ConvexError({ code: 'timeOff.overlap', message: 'This overlaps time off already approved' }),
      );
    await userEvent.selectOptions(within(dialog).getByLabelText('Team member'), 'm_dayo');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record time off' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('overlaps');
    expect(state.mutations['timeOff.record']).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm_dayo', type: 'sick', startDate: '2026-09-14', halfDay: false }),
    );
  });
});

describe('TimeOffOverview', () => {
  it('lets an approver approve, decline with a note, and record for others', async () => {
    state.queries['timeOff.pending'] = [
      entry(),
      entry({ id: 't2', memberId: 'm_kemi', memberName: 'Kemi Bello', canDecide: false, note: undefined }),
    ];
    state.queries['team.list'] = [
      { id: 'm_dayo', name: 'Dayo Ade', status: 'active' },
      { id: 'm_kemi', name: 'Kemi Bello', status: 'active' },
      { id: 'm_new', name: 'New', status: 'invited' },
    ];
    render(<TimeOffOverview permissions={['timeoff.request', 'timeoff.approve', 'team.view']} />);

    const [dayo, kemi] = within(screen.getByRole('region', { name: 'Waiting for a decision' })).getAllByRole(
      'listitem',
    );
    expect(dayo).toHaveTextContent('Annual leave · 30 Sep – 2 Oct 2026 · 2 working days');
    expect(within(kemi).getByText(/someone else decides/)).toBeInTheDocument();
    expect(within(kemi).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    await userEvent.click(within(dayo).getByRole('button', { name: 'Approve' }));
    expect(state.mutations['timeOff.approve']).toHaveBeenCalledWith({ timeOffId: 't1' });

    await userEvent.click(within(dayo).getByRole('button', { name: 'Decline' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Decline Dayo Ade’s request?' });
    await userEvent.type(within(confirm).getByLabelText('Note (optional)'), 'Launch week');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Decline' }));
    await waitFor(() =>
      expect(state.mutations['timeOff.decline']).toHaveBeenCalledWith({ timeOffId: 't1', note: 'Launch week' }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Record for someone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record time off' });
    // Active members other than yourself.
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toContain('Dayo Ade');
    expect(within(dialog).queryByRole('option', { name: 'Kemi Bello' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: 'New' })).not.toBeInTheDocument();
  });

  it('shows a member only their own time off, holidays and a request button', async () => {
    state.queries['timeOff.mine'] = {
      today: '2026-09-14',
      requests: [
        entry({ status: 'approved', decidedByName: 'Kemi Bello', canDecide: false }),
        entry({
          id: 't3',
          status: 'declined',
          decisionNote: 'Launch week',
          decidedByName: 'Kemi Bello',
          canCancel: false,
        }),
      ],
      upcomingHolidays: [{ date: '2026-10-01', name: 'Independence Day', needsConfirmation: false }],
    };
    render(<TimeOffOverview permissions={['timeoff.request']} />);

    expect(screen.queryByRole('region', { name: 'Waiting for a decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Team calendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record for someone' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request time off' })).toBeInTheDocument();

    const rows = within(screen.getByRole('table', { name: 'Your time off' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Approved by Kemi Bello');
    expect(rows[2]).toHaveTextContent('“Launch week”');
    expect(within(rows[2]).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Public holidays' })).toHaveTextContent('1 Oct 2026Independence Day');

    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel this time off?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel time off' }));
    await waitFor(() => expect(state.mutations['timeOff.cancel']).toHaveBeenCalledWith({ timeOffId: 't1' }));
  });
});

describe('LeaveCalendar', () => {
  it('shows who is off each working day, holidays, and pending requests, month by month', async () => {
    state.queries['timeOff.calendar'] = {
      entries: [
        entry({ status: 'approved', type: undefined, note: undefined, canCancel: false }),
        entry({ id: 't2', memberName: 'Kemi Bello', startDate: '2026-09-29', endDate: '2026-09-29' }),
      ],
      holidays: [{ date: '2026-10-01', name: 'Independence Day', needsConfirmation: false }],
      workingWeekdays: [1, 2, 3, 4, 5],
    };
    render(<LeaveCalendar today="2026-09-14" />);
    expect(state.queryArgs['timeOff.calendar']).toEqual({ from: '2026-08-31', to: '2026-10-04' });

    const table = screen.getByRole('table', { name: 'Team time off, September 2026' });
    const cell = (day: string) =>
      within(table)
        .getAllByRole('cell')
        .find((c) => c.querySelector('span')?.textContent === day && !c.className.includes('text-muted-foreground'))!;
    expect(cell('30')).toHaveTextContent('Dayo Ade');
    expect(cell('29')).toHaveTextContent('Kemi Bello (pending)');
    // A holiday shows its name instead of who is off.
    expect(within(table).getByText('Independence Day')).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole('cell')
        .find((c) => c.getAttribute('aria-current') === 'date'),
    ).toHaveTextContent('14');

    const list = screen.getByRole('list', { name: 'Time off in September 2026' });
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent(
      'Kemi Bello29 Sep 2026 · 2 working days · Annual leavePending',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(state.queryArgs['timeOff.calendar']).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(screen.getByRole('table', { name: 'Team time off, October 2026' })).toBeInTheDocument();
  });
});

describe('Business hours and holidays settings', () => {
  it('saves one window per open day and is read-only without settings.manage', async () => {
    state.queries['businessHours.get'] = {
      name: 'Studio hours (Lagos)',
      timezone: 'Africa/Lagos',
      weekly: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
      canEdit: true,
    };
    const { unmount } = render(<BusinessHoursForm />);
    await userEvent.click(screen.getByLabelText('Friday'));
    await userEvent.click(screen.getByLabelText('Saturday'));
    const opens = screen.getByLabelText('Saturday opens');
    await userEvent.clear(opens);
    await userEvent.type(opens, '10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() =>
      expect(state.mutations['businessHours.update']).toHaveBeenCalledWith({
        name: 'Studio hours (Lagos)',
        timezone: 'Africa/Lagos',
        weekly: [
          ...[1, 2, 3, 4].map((day) => ({ day, start: '09:00', end: '17:00' })),
          { day: 6, start: '10:00', end: '17:00' },
        ],
      }),
    );
    unmount();

    state.queries['businessHours.get'] = { ...(state.queries['businessHours.get'] as object), canEdit: false };
    render(<BusinessHoursForm />);
    expect(screen.getByLabelText('Monday')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save hours' })).not.toBeInTheDocument();
  });

  it('confirms an estimated holiday date and removes only holidays added by hand', async () => {
    state.queries['holidays.list'] = {
      canEdit: true,
      holidays: [
        { id: 'h1', date: '2026-03-20', name: 'Eid al-Fitr', source: 'seed', needsConfirmation: true },
        { id: 'h2', date: '2026-03-23', name: 'Eid al-Fitr (second day)', source: 'manual', needsConfirmation: false },
      ],
    };
    render(<HolidaysList />);
    expect(screen.getByText(/1 holiday has an estimated date/)).toBeInTheDocument();
    const [, eid, extra] = screen.getAllByRole('row');
    expect(within(eid).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(within(extra).getByRole('button', { name: 'Remove Eid al-Fitr (second day)' })).toBeInTheDocument();

    await userEvent.click(within(eid).getByRole('button', { name: 'Confirm date for Eid al-Fitr' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm Eid al-Fitr' });
    const date = within(dialog).getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-03-21');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm date' }));
    await waitFor(() =>
      expect(state.mutations['holidays.update']).toHaveBeenCalledWith({
        holidayId: 'h1',
        date: '2026-03-21',
        name: 'Eid al-Fitr',
      }),
    );
  });
});
