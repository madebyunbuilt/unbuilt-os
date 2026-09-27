import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalVault } from '../portal/portal-vault';
import { RevealPanel } from './reveal-panel';
import { VaultItem } from './vault-item';
import { VaultList } from './vault-list';

// The vault's screens (10-vault.md). What is checked here is the part that only exists on screen: a value that arrives,
// stays for as long as the server said, and then is gone again, plus the paths that must never show one.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  actions: {} as Record<string, ReturnType<typeof vi.fn>>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  verifyTotp: vi.fn(),
  push: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue(null);
    return state.mutations[ref._name];
  },
  useAction: (ref: { _name: string }) => {
    state.actions[ref._name] ??= vi.fn().mockResolvedValue(null);
    return state.actions[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/vault',
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { twoFactor: { verifyTotp: (...a: unknown[]) => state.verifyTotp(...a) } },
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return { api: Object.fromEntries(['vault', 'vaultData', 'clients', 'projects'].map((n) => [n, functions(n)])) };
});

const SECRET = 'correct-horse-battery-staple';

const item = (overrides: object = {}) => ({
  id: 'v1',
  clientId: 'c1',
  clientName: 'Glossup',
  projectId: 'p1',
  label: 'Hosting login',
  kind: 'login',
  url: 'https://hosting.example.com',
  hasUsername: true,
  hasNotes: false,
  submittedByKind: 'team',
  rotateByDate: undefined,
  lastRotatedAt: undefined,
  lastRevealedAt: undefined,
  status: 'active',
  keyVersion: 1,
  createdAt: Date.parse('2026-10-01T09:00:00Z'),
  twoFactorVerifiedAt: Date.parse('2026-10-12T09:00:00Z'),
  history: [],
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
  state.queries = { 'vaultData.list': [item()], 'vaultData.get': item(), 'vaultData.portalList': [] };
  state.actions = {};
  state.mutations = {};
  state.verifyTotp = vi.fn().mockResolvedValue({ error: null });
  state.push = vi.fn();
});

afterEach(() => vi.useRealTimers());

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe('revealing a secret', () => {
  const revealed = { username: 'studio@unbuilt.studio', secret: SECRET, hideAfterMs: 30_000 };

  it('shows nothing until asked, then shows the value', async () => {
    state.actions['vault.reveal'] = vi.fn().mockResolvedValue(revealed);
    render(<RevealPanel itemId={'v1' as never} />);

    // Before it is asked for, the value is not on the page and has not been fetched.
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(state.actions['vault.reveal']).not.toHaveBeenCalled();

    await user().click(screen.getByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(screen.getByText('studio@unbuilt.studio')).toBeInTheDocument();
  });

  it('takes it away again after the time the server gave, not a time of its own', async () => {
    state.actions['vault.reveal'] = vi.fn().mockResolvedValue({ ...revealed, hideAfterMs: 5_000 });
    render(<RevealPanel itemId={'v1' as never} />);
    await user().click(screen.getByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText(SECRET)).toBeInTheDocument();

    vi.advanceTimersByTime(4_000);
    expect(screen.getByText(SECRET)).toBeInTheDocument();
    vi.advanceTimersByTime(1_500);
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument());
    // And it offers to show it again rather than leaving an empty box.
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
  });

  it('hides it at once when asked to', async () => {
    state.actions['vault.reveal'] = vi.fn().mockResolvedValue(revealed);
    render(<RevealPanel itemId={'v1' as never} />);
    await user().click(screen.getByRole('button', { name: 'Reveal' }));
    await user().click(await screen.findByRole('button', { name: 'Hide now' }));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('reports a copy, because it is logged separately from a reveal', async () => {
    state.actions['vault.reveal'] = vi.fn().mockResolvedValue(revealed);
    // One session throughout: userEvent installs its own clipboard on setup, so a second setup would replace it.
    const acting = user();
    render(<RevealPanel itemId={'v1' as never} />);
    await acting.click(screen.getByRole('button', { name: 'Reveal' }));

    const rows = await screen.findAllByRole('button', { name: 'Copy' });
    await acting.click(rows[1]);
    await waitFor(() => expect(state.actions['vault.recordCopy']).toHaveBeenCalledWith({ itemId: 'v1' }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    // And it says so, because a copy that looks like nothing happened gets pressed again.
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('asks for a code when the second factor has gone stale, and shows the value once it is accepted', async () => {
    const reveal = vi
      .fn()
      .mockRejectedValueOnce(new ConvexError({ code: 'vault.twoFactorRequired', message: 'Enter your code' }))
      .mockResolvedValueOnce(revealed);
    state.actions['vault.reveal'] = reveal;
    render(<RevealPanel itemId={'v1' as never} />);

    await user().click(screen.getByRole('button', { name: 'Reveal' }));
    const field = await screen.findByLabelText('Enter your authenticator code to see this');
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();

    await user().type(field, '123456');
    await user().click(screen.getByRole('button', { name: 'Check and show' }));
    expect(state.verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
  });

  it('says so when the code is wrong, and shows nothing', async () => {
    state.actions['vault.reveal'] = vi
      .fn()
      .mockRejectedValue(new ConvexError({ code: 'vault.twoFactorRequired', message: 'Enter your code' }));
    state.verifyTotp = vi.fn().mockResolvedValue({ error: { code: 'INVALID_CODE' } });
    render(<RevealPanel itemId={'v1' as never} />);

    await user().click(screen.getByRole('button', { name: 'Reveal' }));
    await user().type(await screen.findByLabelText('Enter your authenticator code to see this'), '000000');
    await user().click(screen.getByRole('button', { name: 'Check and show' }));
    expect(await screen.findByText(/did not work/i)).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('says an item is unavailable rather than hinting it exists', async () => {
    state.actions['vault.reveal'] = vi
      .fn()
      .mockRejectedValue(new ConvexError({ code: 'vault.notFound', message: 'That item is not here' }));
    render(<RevealPanel itemId={'v1' as never} />);
    await user().click(screen.getByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText('This item is not available to you.')).toBeInTheDocument();
  });
});

describe('the vault list', () => {
  it('shows what an item is without showing anything of its value', () => {
    render(<VaultList canManage canSeeAll showClient />);
    expect(screen.getByText('Hosting login')).toBeInTheDocument();
    expect(screen.getByText(/Glossup/)).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('says plainly when there is nothing, rather than showing an empty table', () => {
    state.queries['vaultData.list'] = [];
    render(<VaultList canManage={false} canSeeAll={false} />);
    expect(screen.getByText(/Nothing here/)).toBeInTheDocument();
  });

  it('offers adding only to somebody who may add', () => {
    render(<VaultList canManage={false} canSeeAll={false} />);
    expect(screen.queryByRole('button', { name: /Add a credential/ })).not.toBeInTheDocument();
  });

  it('marks a rotation that has gone past its date', () => {
    state.queries['vaultData.list'] = [item({ rotateByDate: '2026-10-01' })];
    render(<VaultList canManage canSeeAll />);
    expect(screen.getByText('Rotation overdue since 2026-10-01')).toBeInTheDocument();
  });
});

describe('one item', () => {
  it('will not offer to reveal an archived item', () => {
    state.queries['vaultData.get'] = item({ status: 'archived' });
    render(<VaultItem itemId={'v1' as never} canManage />);
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
    expect(screen.getByText(/archived/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('shows who has read it, including who was refused', () => {
    state.queries['vaultData.get'] = item({
      history: [
        { id: 'l1', action: 'reveal', reason: undefined, at: Date.parse('2026-10-12T08:00:00Z'), memberName: 'Tobi' },
        {
          id: 'l2',
          action: 'refused',
          reason: 'not on this project',
          at: Date.parse('2026-10-11T08:00:00Z'),
          memberName: 'Segun',
        },
      ],
    });
    render(<VaultItem itemId={'v1' as never} canManage={false} />);
    expect(screen.getByText(/Tobi revealed/)).toBeInTheDocument();
    expect(screen.getByText(/Segun was refused/)).toBeInTheDocument();
    expect(screen.getByText(/not on this project/)).toBeInTheDocument();
  });

  it('tells somebody refused the item that it is unavailable, and nothing else', () => {
    state.queries['vaultData.get'] = null;
    render(<VaultItem itemId={'v1' as never} canManage />);
    expect(screen.getByText('This item is not available to you.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('hides every editing action from somebody who cannot manage the vault', () => {
    render(<VaultItem itemId={'v1' as never} canManage={false} />);
    for (const name of ['Change details', 'Rotate', 'Archive', 'Delete', 'Mark handed over']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});

describe('what a client sees', () => {
  it('offers sending one, and never shows a value', () => {
    state.queries['vaultData.portalList'] = [
      { id: 'v1', label: 'Analytics login', kind: 'login', url: undefined, submittedAt: Date.now(), status: 'active' },
    ];
    render(<PortalVault />);
    expect(screen.getByRole('button', { name: /Send a credential/ })).toBeInTheDocument();
    expect(screen.getByText('Analytics login')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
  });

  it('says what happens to a value it has, so nobody waits for it to come back', () => {
    render(<PortalVault />);
    expect(screen.getByText(/never shown again/i)).toBeInTheDocument();
  });
});
