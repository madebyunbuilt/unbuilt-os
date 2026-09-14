import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteDialog } from './invite-dialog';
import { MemberProfile } from './member-profile';
import { OnboardingChecklist } from './onboarding-checklist';
import { RatesForm } from './rates-form';
import { TeamList } from './team-list';

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  push: vi.fn(),
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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push, refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/convex/_generated/api', () => {
  const names = [
    'list',
    'get',
    'me',
    'assignableRoles',
    'invite',
    'resendInvite',
    'cancelInvite',
    'updateProfile',
    'changeRole',
    'setRates',
    'suspend',
    'reactivate',
    'offboard',
    'transferOwnership',
    'setChecklistItem',
    'addChecklistItem',
    'removeChecklistItem',
  ];
  return {
    api: {
      team: Object.fromEntries(names.map((name) => [name, { _name: name }])),
      files: { teamDownloadUrl: { _name: 'teamDownloadUrl' } },
    },
  };
});

const roles = [
  { id: 'r_admin', key: 'admin', name: 'Admin', description: 'Everything except transferring ownership.' },
  { id: 'r_pm', key: 'project_manager', name: 'Project manager', description: 'Clients, projects and support.' },
];

const member = (overrides: object = {}) => ({
  id: 'm_dayo',
  name: 'Dayo Ade',
  email: 'dayo@unbuilt.studio',
  title: 'Designer',
  employmentType: 'employee',
  role: { id: 'r_pm', key: 'project_manager', name: 'Project manager', isOwner: false },
  status: 'active',
  invite: null,
  timezone: 'Africa/Lagos',
  skills: ['Figma'],
  twoFactorEnabled: true,
  onboarding: {
    id: 'c1',
    items: [
      { index: 0, label: 'NDA signed', required: true, automatic: false, done: false },
      { index: 1, label: '2FA enabled', required: true, automatic: true, done: true },
    ],
  },
  ...overrides,
});

const me = (overrides: object = {}) => ({ id: 'm_me', name: 'Me', role: { isOwner: false }, ...overrides });

beforeEach(() => {
  state.queries = { assignableRoles: roles, me: me() };
  state.queryArgs = {};
  state.mutations = {};
  state.push.mockClear();
});

describe('TeamList', () => {
  it('searches by name, email, title or role and asks for offboarded members on request', async () => {
    state.queries.list = [
      member(),
      member({
        id: 'm_kemi',
        name: 'Kemi Bello',
        email: 'kemi@unbuilt.studio',
        title: 'Finance lead',
        role: { name: 'Finance' },
      }),
    ];
    render(<TeamList canInvite={false} />);

    expect(screen.getAllByRole('row')).toHaveLength(3);
    await userEvent.type(screen.getByLabelText('Search the team'), 'finance');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Kemi Bello/ })).toHaveAttribute('href', '/team/m_kemi');

    expect(state.queryArgs.list).toEqual({ includeOffboarded: false });
    await userEvent.click(screen.getByRole('switch', { name: 'Show offboarded' }));
    expect(state.queryArgs.list).toEqual({ includeOffboarded: true });
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
  });
});

describe('InviteDialog', () => {
  it('invites with the chosen role and opens the new profile', { timeout: 15_000 }, async () => {
    const onInvited = vi.fn();
    render(<InviteDialog onInvited={onInvited} />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite a team member' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText('Enter an email address')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Role')).toHaveAttribute('aria-invalid', 'true');

    state.mutations.invite = vi.fn().mockResolvedValue('m_new');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new@unbuilt.studio');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'New Person');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'r_pm');
    expect(within(dialog).getByText('Clients, projects and support.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() =>
      expect(state.mutations.invite).toHaveBeenCalledWith({
        email: 'new@unbuilt.studio',
        name: 'New Person',
        title: undefined,
        roleId: 'r_pm',
        employmentType: 'employee',
        timezone: 'Africa/Lagos',
        skills: [],
      }),
    );
    expect(onInvited).toHaveBeenCalledWith('m_new');
  });

  it('shows why the server refused', async () => {
    render(<InviteDialog />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    const dialog = await screen.findByRole('dialog');
    state.mutations.invite = vi
      .fn()
      .mockRejectedValue(
        new ConvexError({ code: 'team.exists', message: 'new@unbuilt.studio is already on the team' }),
      );
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new@unbuilt.studio');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'New');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'r_admin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already on the team');
  });
});

describe('MemberProfile', () => {
  it('is read-only for a project manager: no editing, access or ownership controls', () => {
    state.queries.get = member();
    render(<MemberProfile memberId={'m_dayo' as never} permissions={['team.view']} />);
    expect(screen.getByRole('heading', { name: 'Dayo Ade' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ownership' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /NDA signed/ })).toBeDisabled();
  });

  it('gives an admin editing and access controls, and shows rates only when the query returned them', async () => {
    state.queries.get = member({ rates: { costRateMinor: 1_000_000, currency: 'NGN' } });
    render(<MemberProfile memberId={'m_dayo' as never} permissions={['team.view', 'team.manage']} />);
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rates' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cost rate')).toHaveValue('10000');

    await userEvent.selectOptions(screen.getByLabelText('Role'), 'r_admin');
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));
    expect(state.mutations.changeRole).toHaveBeenCalledWith({ memberId: 'm_dayo', roleId: 'r_admin' });

    await userEvent.click(screen.getByRole('button', { name: 'Offboard' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Offboard Dayo Ade?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Offboard' }));
    await waitFor(() =>
      expect(state.mutations.offboard).toHaveBeenCalledWith({
        memberId: 'm_dayo',
        endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it('never shows access controls on your own profile or the Owner’s', () => {
    state.queries.me = me({ id: 'm_dayo' });
    state.queries.get = member();
    const { unmount } = render(
      <MemberProfile memberId={'m_dayo' as never} permissions={['team.view', 'team.manage']} />,
    );
    expect(screen.queryByRole('heading', { name: 'Access' })).not.toBeInTheDocument();
    unmount();

    state.queries.me = me();
    state.queries.get = member({ role: { id: 'r_owner', key: 'owner', name: 'Owner', isOwner: true } });
    render(<MemberProfile memberId={'m_dayo' as never} permissions={['team.view', 'team.manage']} />);
    expect(screen.queryByRole('heading', { name: 'Access' })).not.toBeInTheDocument();
  });

  it('explains a role the admin cannot change because it holds more than they do', () => {
    state.queries.get = member({ role: { id: 'r_finance', key: 'finance', name: 'Finance', isOwner: false } });
    render(<MemberProfile memberId={'m_dayo' as never} permissions={['team.view', 'team.manage']} />);
    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByText(/permissions you do not hold/)).toBeInTheDocument();
  });

  it('lets the Owner transfer ownership only after typing the member’s name', async () => {
    state.queries.me = me({ role: { isOwner: true } });
    state.queries.get = member();
    render(<MemberProfile memberId={'m_dayo' as never} permissions={['team.view', 'team.manage', 'owner.transfer']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Transfer ownership to Dayo Ade' }));
    const confirm = await screen.findByRole('alertdialog');
    const submit = within(confirm).getByRole('button', { name: 'Transfer ownership' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(confirm).getByLabelText('Their name'), 'Dayo Ade');
    await userEvent.click(submit);
    await waitFor(() => expect(state.mutations.transferOwnership).toHaveBeenCalledWith({ toMemberId: 'm_dayo' }));
  });

  it('asks the member to set up 2FA before ownership can move to them', () => {
    state.queries.me = me({ role: { isOwner: true } });
    state.queries.get = member({ twoFactorEnabled: false });
    render(<MemberProfile memberId={'m_dayo' as never} permissions={['team.view', 'owner.transfer']} />);
    expect(screen.getByText(/must set up two-factor authentication/)).toBeInTheDocument();
    expect(screen.getByText('2FA not set up')).toBeInTheDocument();
  });

  it('offers resend and cancel for a pending invitation, highlighting an expired one', async () => {
    state.queries.get = member({ status: 'invited', invite: 'expired', twoFactorEnabled: false });
    render(<MemberProfile memberId={'m_dayo' as never} permissions={['team.view', 'team.manage']} />);
    expect(screen.getByText('This invitation has expired.')).toBeInTheDocument();
    expect(screen.getByText('Invite expired')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resend invitation' }));
    expect(state.mutations.resendInvite).toHaveBeenCalledWith({ memberId: 'm_dayo' });
    expect(await screen.findByText(/valid for 14 days/)).toBeInTheDocument();
  });

  it('lets an admin fix the role of a pending invitation, without suspend or offboard', async () => {
    state.queries.get = member({ status: 'invited', invite: 'pending', twoFactorEnabled: false, onboarding: null });
    render(<MemberProfile memberId={'m_dayo' as never} permissions={['team.view', 'team.manage']} />);
    expect(screen.getByRole('heading', { name: 'Access' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Offboard' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Role'), 'r_admin');
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));
    expect(state.mutations.changeRole).toHaveBeenCalledWith({ memberId: 'm_dayo', roleId: 'r_admin' });
    expect(await screen.findByText(/resend the invitation to update it/)).toBeInTheDocument();
  });
});

describe('OnboardingChecklist', () => {
  it('ticks manual items, leaves automatic ones alone, and adds items', async () => {
    render(
      <OnboardingChecklist
        memberId={'m_dayo' as never}
        editable
        items={[
          { index: 0, label: 'NDA signed', required: true, automatic: false, done: false },
          { index: 1, label: '2FA enabled', required: true, automatic: true, done: true },
        ]}
      />,
    );
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /2FA enabled/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove “2FA enabled”' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /NDA signed/ }));
    expect(state.mutations.setChecklistItem).toHaveBeenCalledWith({ memberId: 'm_dayo', index: 0, done: true });

    await userEvent.type(screen.getByLabelText('New checklist item'), 'Laptop issued');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.mutations.addChecklistItem).toHaveBeenCalledWith({
      memberId: 'm_dayo',
      label: 'Laptop issued',
      required: false,
    });
  });
});

describe('RatesForm', () => {
  it('saves rates in minor units and explains bad amounts', async () => {
    render(<RatesForm memberId={'m_dayo' as never} rates={{}} />);
    await userEvent.type(screen.getByLabelText('Cost rate'), '15,000.50');
    await userEvent.type(screen.getByLabelText('Bill rate'), '30000');
    await userEvent.click(screen.getByRole('button', { name: 'Save rates' }));
    expect(state.mutations.setRates).toHaveBeenCalledWith({
      memberId: 'm_dayo',
      currency: 'NGN',
      costRateMinor: 1_500_050,
      billRateMinor: 3_000_000,
    });

    await userEvent.clear(screen.getByLabelText('Bill rate'));
    await userEvent.type(screen.getByLabelText('Bill rate'), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Save rates' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid NGN amount/);
  });
});
