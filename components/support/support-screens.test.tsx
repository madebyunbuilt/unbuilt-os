import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketDetail } from './ticket-detail';
import { TicketList } from './ticket-list';

// The support screens (09-support-and-sla.md): what was promised and how it is doing, said in words, and never any
// doubt about which messages the client can read.

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
  return {
    api: Object.fromEntries(
      ['tickets', 'clients', 'projects', 'contacts', 'team', 'files', 'time'].map((n) => [n, functions(n)]),
    ),
  };
});

const NOW = Date.parse('2026-10-12T09:00:00+01:00');

const ticket = (overrides: object = {}) => ({
  id: 't1',
  number: 'UNB-TKT-0001',
  clientId: 'c1',
  projectId: undefined,
  subject: 'Checkout is down',
  priority: 'p1',
  status: 'new',
  channel: 'portal',
  assigneeMemberId: undefined,
  requesterContactId: 'ct1',
  createdAt: Date.parse('2026-10-08T16:55:00+01:00'),
  firstResponseDueAt: Date.parse('2026-10-12T09:55:00+01:00'),
  resolutionDueAt: Date.parse('2026-10-12T16:55:00+01:00'),
  firstRespondedAt: undefined,
  resolvedAt: undefined,
  closedAt: undefined,
  pausedAt: undefined,
  hasSla: true,
  needsTriage: false,
  fromEmail: undefined,
  minutesLogged: 0,
  ...overrides,
});

const detail = (overrides: object = {}) => ({
  ...ticket(),
  clientName: 'Glossup',
  slaPolicyName: 'Standard',
  messages: [
    {
      id: 'm1',
      visibility: 'public',
      body: 'Nobody can pay.',
      authorKind: 'client',
      authorMemberId: undefined,
      authorContactId: 'ct1',
      files: [],
      createdAt: Date.parse('2026-10-08T16:55:00+01:00'),
    },
  ],
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  state.queries = {
    'tickets.list': [ticket()],
    'tickets.get': detail(),
    'team.list': [{ id: 'm-tobi', name: 'Tobi Ade', status: 'active' }],
    'clients.list': [{ id: 'c1', displayName: 'Glossup' }],
    'projects.list': [],
    'contacts.listForClient': [],
  };
  state.mutations = {};
});

describe('the ticket list', () => {
  it('says how long is left, rather than printing a timestamp', () => {
    render(<TicketList permissions={['tickets.view.all']} />);
    expect(screen.getByText('Reply due in 55 minutes')).toBeInTheDocument();
    expect(screen.getByText('P1')).toBeInTheDocument();
  });

  it('says plainly when a promise has been missed', () => {
    state.queries['tickets.list'] = [ticket({ firstResponseDueAt: NOW - 3 * 60 * 60 * 1000 })];
    render(<TicketList permissions={['tickets.view.all']} />);
    expect(screen.getByText('Reply 3 hours late')).toBeInTheDocument();
  });

  it('puts whatever runs out first at the top', () => {
    state.queries['tickets.list'] = [
      ticket({ id: 'later', subject: 'Slow one', firstResponseDueAt: NOW + 5 * 60 * 60 * 1000 }),
      ticket({ id: 'sooner', subject: 'Urgent one', firstResponseDueAt: NOW + 10 * 60 * 1000 }),
    ];
    render(<TicketList permissions={['tickets.view.all']} />);
    const subjects = screen.getAllByRole('link').map((link) => within(link).getByText(/one$/).textContent);
    expect(subjects).toEqual(['Urgent one', 'Slow one']);
  });

  it('puts an unplaced email at the top, where nothing is counting for it', () => {
    state.queries['tickets.list'] = [
      ticket({ id: 'urgent', subject: 'Running out', firstResponseDueAt: NOW + 60_000 }),
      ticket({ id: 'email', subject: 'From a stranger', needsTriage: true, fromEmail: 'nobody@example.com' }),
    ];
    render(<TicketList permissions={['tickets.view.all']} />);
    expect(screen.getAllByRole('link')[0]).toHaveTextContent('From a stranger');
    expect(screen.getByText('Needs placing')).toBeInTheDocument();
    expect(screen.getByText(/nobody@example\.com/)).toBeInTheDocument();
  });

  it('does not count down a ticket that is waiting on the client', () => {
    state.queries['tickets.list'] = [ticket({ status: 'pending_client', firstRespondedAt: NOW - 60_000 })];
    render(<TicketList permissions={['tickets.view.all']} />);
    expect(screen.getByText('Clock paused')).toBeInTheDocument();
  });

  it('offers no way to raise one to somebody who may only read', () => {
    render(<TicketList permissions={['tickets.view.assigned']} />);
    expect(screen.queryByRole('button', { name: 'Raise a ticket' })).not.toBeInTheDocument();
  });

  it('sends what was typed when the studio raises one on a client’s behalf', async () => {
    render(<TicketList permissions={['tickets.view.all', 'tickets.manage']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Raise a ticket' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.selectOptions(dialog.getByLabelText('Client'), 'c1');
    await userEvent.selectOptions(dialog.getByLabelText('Priority'), 'p2');
    await userEvent.type(dialog.getByLabelText('Subject'), 'Payments failing');
    await userEvent.type(dialog.getByLabelText('What they reported'), 'Cards are declined.');
    await userEvent.click(dialog.getByRole('button', { name: 'Raise it' }));
    await waitFor(() =>
      expect(state.mutations['tickets.create']).toHaveBeenCalledWith({
        clientId: 'c1',
        projectId: undefined,
        requesterContactId: undefined,
        subject: 'Payments failing',
        description: 'Cards are declined.',
        priority: 'p2',
      }),
    );
  });
});

describe('one ticket', () => {
  const permissions = ['tickets.view.all', 'tickets.manage'];

  it('leads with what was promised and how it is doing', () => {
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText('Promised under Standard')).toBeInTheDocument();
    expect(screen.getByText('Reply due in 55 minutes')).toBeInTheDocument();
  });

  it('says there is no promise when the client has no policy, rather than showing an empty clock', () => {
    state.queries['tickets.get'] = detail({
      hasSla: false,
      firstResponseDueAt: undefined,
      resolutionDueAt: undefined,
      slaPolicyName: undefined,
    });
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText(/no SLA policy, so nothing was promised/)).toBeInTheDocument();
  });

  it('explains why a paused ticket is not counting down', () => {
    state.queries['tickets.get'] = detail({ status: 'pending_client', pausedAt: NOW - 60_000 });
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText('Fix — clock paused')).toBeInTheDocument();
    expect(screen.getByText(/added back when it starts again/)).toBeInTheDocument();
  });

  it('marks an internal note as one the client never sees', () => {
    state.queries['tickets.get'] = detail({
      messages: [
        ...detail().messages,
        {
          id: 'm2',
          visibility: 'internal',
          body: 'Suspect the gateway.',
          authorKind: 'team',
          authorMemberId: 'm-tobi',
          authorContactId: undefined,
          files: [],
          createdAt: NOW,
        },
      ],
    });
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText('Internal note')).toBeInTheDocument();
    expect(screen.getByText('The client never sees this.')).toBeInTheDocument();
  });

  it('warns that a note is not the first reply', async () => {
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    await userEvent.selectOptions(screen.getByLabelText('Who sees this'), 'internal');
    expect(screen.getByText(/does not count as the first reply/)).toBeInTheDocument();
  });

  it('sends a reply as public or internal, as chosen', async () => {
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    await userEvent.type(screen.getByLabelText('Reply to the client'), 'We are on it.');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the client' }));
    await waitFor(() =>
      expect(state.mutations['tickets.reply']).toHaveBeenCalledWith({
        ticketId: 't1',
        body: 'We are on it.',
        visibility: 'public',
        uploads: [],
      }),
    );
  });

  it('opens a file the client sent, from inside the thread', () => {
    state.queries['tickets.get'] = detail({
      messages: [{ ...detail().messages[0], files: [{ id: 'f1', name: 'broken.png' }] }],
    });
    state.queries['files.teamDownloadUrl'] = { url: 'https://example.test/broken.png', name: 'broken.png' };
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByRole('link', { name: 'broken.png' })).toHaveAttribute('href', 'https://example.test/broken.png');
  });

  it('says who a file is being attached for, so a note’s file is not sent to the client by accident', async () => {
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByLabelText('Attach a file for the client')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Who sees this'), 'internal');
    expect(screen.getByLabelText('Attach a file to the note')).toBeInTheDocument();
  });

  it('sends a file on its own, with nothing typed', async () => {
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByRole('button', { name: 'Send to the client' })).toBeDisabled();
    const shot = new File(['pretend'], 'fix.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Attach a file for the client'), shot);
    expect(screen.getByRole('button', { name: 'Send to the client' })).toBeEnabled();
  });

  it('asks who an unplaced email is from, instead of showing a clock nobody set', async () => {
    state.queries['tickets.get'] = detail({
      needsTriage: true,
      fromEmail: 'nobody@example.com',
      clientName: undefined,
      hasSla: false,
      firstResponseDueAt: undefined,
      resolutionDueAt: undefined,
      slaPolicyName: undefined,
    });
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText('Who is this from?')).toBeInTheDocument();
    expect(screen.getByText(/nobody@example\.com wrote to support/)).toBeInTheDocument();
    // The consequence of answering, said before they answer.
    expect(screen.getByText(/clock then runs from when the email arrived/)).toBeInTheDocument();
    expect(screen.queryByText(/no SLA policy/)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Client'), 'c1');
    await userEvent.click(screen.getByRole('button', { name: 'This is their ticket' }));
    await waitFor(() =>
      expect(state.mutations['tickets.triage']).toHaveBeenCalledWith({
        ticketId: 't1',
        clientId: 'c1',
        requesterContactId: undefined,
      }),
    );
  });

  it('says a ticket is not here instead of failing the page', () => {
    state.queries['tickets.get'] = null;
    render(<TicketDetail ticketId={'gone' as never} permissions={permissions} />);
    expect(screen.getByText(/That ticket is not here/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Tickets' })).toBeInTheDocument();
  });

  it('will not offer to log time against a ticket with nowhere to put it', () => {
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText(/Put this ticket on a project to log time/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log time' })).not.toBeInTheDocument();
  });

  it('logs time against the ticket and its project', async () => {
    state.queries['tickets.get'] = detail({ projectId: 'p1', minutesLogged: 90 });
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText('Time logged: 1h 30m')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Log time' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('How long'), '45m');
    await userEvent.type(dialog.getByLabelText('What you did'), 'Checked the gateway');
    await userEvent.click(dialog.getByRole('button', { name: 'Log it' }));
    await waitFor(() =>
      expect(state.mutations['time.log']).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p1', ticketId: 't1', minutes: 45, billable: true }),
      ),
    );
  });

  it('says what changing the priority does to the promise', () => {
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText(/works the promise out again from when the ticket was raised/)).toBeInTheDocument();
  });

  it('shows the server’s reason when a change is refused', async () => {
    const { ConvexError } = await import('convex/values');
    state.mutations['tickets.setStatus'] = vi
      .fn()
      .mockRejectedValue(new ConvexError({ code: 'tickets.closed', message: 'This ticket is closed' }));
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    await userEvent.selectOptions(screen.getByLabelText('Where it stands'), 'resolved');
    expect(await screen.findByRole('alert')).toHaveTextContent('This ticket is closed');
  });

  it('offers a reader the thread and nothing to change', () => {
    render(<TicketDetail ticketId={'t1' as never} permissions={['tickets.view.all']} />);
    expect(screen.getByText('Nobody can pay.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Where it stands')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reply to the client')).not.toBeInTheDocument();
  });

  it('closes the door on a closed ticket instead of showing a reply box that fails', () => {
    state.queries['tickets.get'] = detail({ status: 'closed', closedAt: NOW });
    render(<TicketDetail ticketId={'t1' as never} permissions={permissions} />);
    expect(screen.getByText(/Raise a new one if the client comes back/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply to the client')).not.toBeInTheDocument();
  });
});
