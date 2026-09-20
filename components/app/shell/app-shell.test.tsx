import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/app/theme-provider';
import { DEFAULT_ROLES } from '@/convex/lib/permissions';
import { AppShell } from './app-shell';

vi.mock('convex/react', () => ({
  useQuery: () => ({ items: [], unreadCount: 0 }),
  useMutation: () => vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));

const permissionsOf = (key: string) => [...(DEFAULT_ROLES.find((role) => role.key === key)?.permissions ?? [])];
const user = { name: 'Dayo Ade', email: 'dayo@unbuilt.studio', roleName: 'Member' };

function renderShell(permissions: string[], surface: 'team' | 'portal' = 'team') {
  return render(
    <ThemeProvider>
      <AppShell surface={surface} user={user} permissions={permissions}>
        <p>Page content</p>
        <input aria-label="A field" />
      </AppShell>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AppShell', () => {
  it('shows only the navigation the role allows, with unbuilt modules marked and inert', () => {
    renderShell(permissionsOf('member'));
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];

    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByText('Invoices')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Enquiries')).not.toBeInTheDocument();

    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');

    const documents = within(nav).getByText('Documents').closest('[aria-disabled]');
    expect(documents).toHaveAttribute('aria-disabled', 'true');
    expect(documents).toHaveTextContent('Not built yet');
    expect(within(nav).queryByRole('link', { name: /Documents/ })).not.toBeInTheDocument();
  });

  it('uses portal navigation on the portal', () => {
    renderShell(permissionsOf('client_member'), 'portal');
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
    expect(within(nav).getByText('Support')).toBeInTheDocument();
    expect(within(nav).queryByText('Invoices')).not.toBeInTheDocument();
    expect(screen.getAllByText('Client portal').length).toBeGreaterThan(0);
  });

  it('offers a skip link to the page content', () => {
    renderShell([]);
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('opens the command palette with Ctrl K or ⌘K', async () => {
    renderShell(permissionsOf('owner'));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByPlaceholderText('Type a page or command…')).toHaveFocus();
    expect(within(palette).getByText('Dark theme')).toBeInTheDocument();
  });

  it('shows keyboard shortcuts on ?, but not while typing', async () => {
    renderShell([]);
    const field = screen.getByLabelText('A field');
    field.focus();
    await userEvent.keyboard('?');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();

    field.blur();
    fireEvent.keyDown(window, { key: '?' });
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('switches to dark mode from the account menu and remembers it', async () => {
    renderShell([]);
    await userEvent.click(screen.getByRole('button', { name: 'Account menu for Dayo Ade' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(localStorage.getItem('unbuilt-theme')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });
});
