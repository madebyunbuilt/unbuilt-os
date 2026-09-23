import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPage } from './notifications-page';

// The notifications screen (14-platform.md, Notifications): everything grouped by day, the unread on their own, and
// older ones fetched a page at a time.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  push: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => {
    state.queryArgs[ref._name] = args;
    return state.queries[ref._name];
  },
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue(undefined);
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/convex/_generated/api', () => ({
  api: { notifications: new Proxy({}, { get: (_, fn: string) => ({ _name: `notifications.${fn}` }) }) },
}));

const notice = (id: string, title: string, overrides: object = {}) => ({
  id,
  title,
  body: `${title} body`,
  read: false,
  createdAt: Date.now() - 60_000,
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'notifications.teamFeed': {
      items: [
        notice('n1', '₦2,000.00 received on UNB-INV-0007', { link: '/billing/invoices/i1' }),
        notice('n2', 'UNB-SLA-0001 is signed', { read: true }),
      ],
      unreadCount: 1,
      nextBefore: 1_000,
    },
  };
  state.queryArgs = {};
  state.mutations = {};
  state.push.mockClear();
});

describe('NotificationsPage', () => {
  it('lists today’s notifications, opens one and marks it read', async () => {
    render(<NotificationsPage surface="team" />);
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getAllByRole('button')).toHaveLength(2);

    await userEvent.click(within(today).getByRole('button', { name: /received on UNB-INV-0007/ }));
    await waitFor(() =>
      expect(state.mutations['notifications.teamMarkRead']).toHaveBeenCalledWith({ notificationId: 'n1' }),
    );
    expect(state.push).toHaveBeenCalledWith('/billing/invoices/i1');
  });

  it('shows only the unread when asked, and marks all read', async () => {
    render(<NotificationsPage surface="team" />);
    await userEvent.click(screen.getByRole('button', { name: 'Unread (1)' }));
    await waitFor(() =>
      expect(state.queryArgs['notifications.teamFeed']).toEqual({ before: undefined, unreadOnly: true }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(state.mutations['notifications.teamMarkAllRead']).toHaveBeenCalled());
  });

  it('fetches older ones a page at a time', async () => {
    render(<NotificationsPage surface="team" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await waitFor(() =>
      expect(state.queryArgs['notifications.teamFeed']).toEqual({ before: 1_000, unreadOnly: false }),
    );
  });

  it('says when there is nothing, and reads the portal’s own list there', () => {
    state.queries['notifications.portalFeed'] = { items: [], unreadCount: 0 };
    render(<NotificationsPage surface="portal" />);
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });
});
