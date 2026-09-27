import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './command-palette';
import { TEAM_PERMISSIONS } from '@/convex/lib/permissions';
import { navigationFor } from '@/lib/navigation';

// The palette as somebody actually uses it (14-platform.md). The matching is tested on its own in lib/destinations;
// what is tested here is that typing into the real dialog reaches it, which is exactly what once did not.

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/app/theme-provider', () => ({ useTheme: () => ({ setPreference: vi.fn() }) }));
vi.mock('@/components/auth/use-sign-out', () => ({ useSignOut: () => ({ signOut: vi.fn() }) }));

const permissions: string[] = [...TEAM_PERMISSIONS];

function open() {
  render(
    <CommandPalette
      open
      onOpenChange={vi.fn()}
      surface="team"
      sections={navigationFor('team', permissions)}
      permissions={permissions}
      onShowShortcuts={vi.fn()}
    />,
  );
  return screen.getByPlaceholderText('Search pages, settings and commands…');
}

describe('typing into the palette', () => {
  it('finds a setting by a word that appears on no page or heading', async () => {
    const input = open();
    await userEvent.type(input, 'vat');
    expect(await screen.findByText('VAT and payment terms')).toBeInTheDocument();
    expect(screen.getByText('Settings › Billing')).toBeInTheDocument();
  });

  it('finds bank details by iban, which is nowhere in the navigation', async () => {
    const input = open();
    await userEvent.type(input, 'iban');
    expect(await screen.findByText('Bank accounts')).toBeInTheDocument();
  });

  it('goes where the result points, anchor and all', async () => {
    const input = open();
    await userEvent.type(input, 'iban');
    await userEvent.click(await screen.findByText('Bank accounts'));
    expect(push).toHaveBeenCalledWith('/settings/billing#bank-heading');
  });

  it('puts the page named after the word first', async () => {
    const input = open();
    await userEvent.type(input, 'invoices');
    const results = screen.getAllByRole('option');
    expect(results[0]).toHaveTextContent('Invoices');
  });

  it('says so when nothing matches', async () => {
    const input = open();
    await userEvent.type(input, 'aardvark');
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
  });
});

describe('the commands it runs', () => {
  it('answers to what was typed, like everything else', async () => {
    const input = open();
    await userEvent.type(input, 'dark');
    expect(await screen.findByText('Dark theme')).toBeInTheDocument();
    // Not offered for a word that has nothing to do with it.
    expect(screen.queryByText('Sign out')).not.toBeInTheDocument();
  });

  it('is found by what somebody would call it', async () => {
    const input = open();
    await userEvent.type(input, 'log out');
    expect(await screen.findByText('Sign out')).toBeInTheDocument();
  });

  it('shows everything when nothing has been typed', () => {
    open();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
  });
});
