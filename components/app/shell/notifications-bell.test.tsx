import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsBell } from './notifications-bell';

const state = vi.hoisted(() => ({
  result: undefined as unknown,
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  push: vi.fn(),
  queried: [] as string[],
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: unknown) => {
    state.queried.push(String((ref as { _name?: string })._name ?? ref));
    return state.result;
  },
  useMutation: (ref: unknown) => {
    const name = String((ref as { _name?: string })._name ?? ref);
    return name.includes('MarkAllRead') ? state.markAllRead : state.markRead;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/convex/_generated/api', () => ({
  api: {
    notifications: {
      teamList: { _name: 'notifications:teamList' },
      teamMarkRead: { _name: 'notifications:teamMarkRead' },
      teamMarkAllRead: { _name: 'notifications:teamMarkAllRead' },
      portalList: { _name: 'notifications:portalList' },
      portalMarkRead: { _name: 'notifications:portalMarkRead' },
      portalMarkAllRead: { _name: 'notifications:portalMarkAllRead' },
    },
  },
}));

const now = Date.now();
const item = (id: string, overrides: object = {}) => ({
  id,
  event: 'test',
  title: `Title ${id}`,
  body: `Body ${id}`,
  read: false,
  createdAt: now,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.queried = [];
});

describe('NotificationsBell', () => {
  it('announces the unread count and caps the badge at 99+', () => {
    state.result = { items: [], unreadCount: 100 };
    render(<NotificationsBell surface="team" />);
    expect(screen.getByRole('button', { name: 'Notifications, 99+ unread' })).toBeInTheDocument();
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('reads the portal list on the portal', () => {
    state.result = { items: [], unreadCount: 0 };
    render(<NotificationsBell surface="portal" />);
    expect(state.queried).toContain('notifications:portalList');
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('groups by day, marks an item read and follows its link', async () => {
    state.result = {
      items: [
        item('a', { link: '/billing/invoices/1' }),
        item('b', { read: true, createdAt: now - 3 * 24 * 60 * 60 * 1000 }),
      ],
      unreadCount: 1,
    };
    render(<NotificationsBell surface="team" />);
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));

    const today = await screen.findByRole('region', { name: 'Today' });
    await userEvent.click(within(today).getByRole('button', { name: /Title a/ }));
    expect(state.markRead).toHaveBeenCalledWith({ notificationId: 'a' });
    expect(state.push).toHaveBeenCalledWith('/billing/invoices/1');
  });

  it('does not re-mark read items and marks all read on request', async () => {
    state.result = { items: [item('b', { read: true })], unreadCount: 0 };
    const { rerender } = render(<NotificationsBell surface="team" />);
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    await userEvent.click(await screen.findByRole('button', { name: /Title b/ }));
    expect(state.markRead).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();

    state.result = { items: [item('c')], unreadCount: 1 };
    rerender(<NotificationsBell surface="team" />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(state.markAllRead).toHaveBeenCalledWith({});
  });

  it('explains an empty list', async () => {
    state.result = { items: [], unreadCount: 0 };
    render(<NotificationsBell surface="team" />);
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
  });
});
