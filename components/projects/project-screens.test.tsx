import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliverableDetail } from './deliverable-detail';
import { MembersPanel } from './members-panel';
import { MilestonesPanel } from './milestones-panel';
import { ProjectHeader } from './project-header';
import { ProjectList } from './project-list';
import { ProjectOverview } from './project-overview';
import { ProjectSettings } from './project-settings';
import { WinDealDialog, type WinnableDeal } from './win-deal-dialog';

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  pages: [] as unknown[],
  push: vi.fn(),
  pathname: '/projects/p1',
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => {
    if (args === 'skip') return undefined;
    state.queryArgs[ref._name] = args;
    return state.queries[ref._name];
  },
  usePaginatedQuery: (ref: { _name: string }, args: unknown) => {
    state.queryArgs[ref._name] = args;
    return { results: state.pages, status: 'Exhausted', loadMore: vi.fn() };
  },
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue(undefined);
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => state.pathname,
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: {
      projects: functions('projects'),
      projectTemplates: functions('projectTemplates'),
      milestones: functions('milestones'),
      deliverables: functions('deliverables'),
      comments: functions('comments'),
      activities: functions('activities'),
      clients: functions('clients'),
      files: functions('files'),
      team: functions('team'),
      time: functions('time'),
    },
  };
});

const project = (overrides: object = {}) => ({
  id: 'p1',
  code: 'UNB-P-0007',
  name: 'Glossup app',
  clientId: 'c1',
  clientName: 'Glossup',
  type: 'mobile_app',
  status: 'planning',
  billingModel: 'fixed',
  currency: 'NGN',
  startDate: '2026-09-01',
  dueDate: '2026-12-01',
  managerMemberId: 'm_tobi',
  managerName: 'Tobi Ade',
  milestoneProgress: { done: 1, total: 3 },
  nextMilestone: 'Design',
  budgetMinor: 250_000_00,
  dealId: undefined,
  dealTitle: undefined,
  slaPolicyId: undefined,
  links: {},
  description: undefined,
  completedAt: undefined,
  handoverStatus: 'not_started',
  members: [
    {
      memberId: 'm_tobi',
      name: 'Tobi Ade',
      title: 'Founder',
      projectRole: undefined,
      isManager: true,
      status: 'active',
    },
    {
      memberId: 'mkemi',
      name: 'Kemi Bello',
      title: 'Designer',
      projectRole: 'Designer',
      isManager: false,
      status: 'active',
    },
  ],
  isMember: true,
  tasks: { open: 4, overdue: 1, estimateMinutes: 600 },
  ...overrides,
});

const PM = [
  'projects.view.assigned',
  'projects.create',
  'projects.update',
  'projects.members.manage',
  'deliverables.manage.assigned',
  'team.view',
  'clients.view',
];
const MEMBER = ['projects.view.assigned', 'deliverables.manage.assigned'];

beforeEach(() => {
  state.queries = {
    'projects.get': project(),
    'team.me': { id: 'm_tobi', name: 'Tobi Ade' },
    'team.list': [
      { id: 'm_tobi', name: 'Tobi Ade', status: 'active' },
      { id: 'mkemi', name: 'Kemi Bello', status: 'active' },
      { id: 'mzuri', name: 'Zuri Cole', status: 'active' },
    ],
    'projectTemplates.list': [
      {
        id: 't1',
        name: 'Mobile app',
        type: 'mobile_app',
        milestones: [{ name: 'Design', deliverables: ['Figma'] }],
        tasks: [{ title: 'Kickoff' }],
      },
    ],
    'clients.list': [{ id: 'c1', displayName: 'Glossup' }],
    'clients.slaPolicyOptions': [{ id: 'sla1', name: 'Standard' }],
  };
  state.queryArgs = {};
  state.mutations = {};
  state.pages = [];
  state.push.mockClear();
  state.pathname = '/projects/p1';
});

describe('ProjectList', () => {
  it('filters by status and by who manages, and creates a project from a template', async () => {
    state.queries['projects.list'] = [project()];
    render(<ProjectList permissions={PM} />);

    expect(screen.getByRole('link', { name: /Glossup app/ })).toHaveAttribute('href', '/projects/p1');
    expect(screen.getByText('1 of 3 · next: Design')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Show'), 'completed');
    expect(state.queryArgs['projects.list']).toMatchObject({ status: 'completed' });
    await userEvent.click(screen.getByLabelText('I manage'));
    expect(state.queryArgs['projects.list']).toMatchObject({ managerMemberId: 'm_tobi' });

    state.mutations['projects.create'] = vi.fn().mockResolvedValue('p2');
    await userEvent.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Client'), 'c1');
    await userEvent.selectOptions(within(dialog).getByLabelText('Template (optional)'), 't1');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Mobile app');
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Glossup app');
    await userEvent.type(within(dialog).getByLabelText('Budget (optional)'), '250000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(state.mutations['projects.create']).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'c1',
          templateId: 't1',
          name: 'Glossup app',
          type: 'mobile_app',
          budgetMinor: 250_000_00,
        }),
      ),
    );
    expect(state.push).toHaveBeenCalledWith('/projects/p2');
  });

  it('hides creating projects without projects.create', () => {
    state.queries['projects.list'] = [];
    render(<ProjectList permissions={MEMBER} />);
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
    expect(screen.getByText('No open projects.')).toBeInTheDocument();
  });
});

describe('ProjectHeader', () => {
  it('shows the billing tabs to whoever holds the billing permissions', () => {
    state.pathname = '/projects/p1';
    render(
      <ProjectHeader
        projectId={'p1' as never}
        permissions={[...PM, 'invoices.view', 'schedules.manage', 'changerequests.create']}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Project sections' });
    expect(within(nav).getByRole('link', { name: 'Invoices' })).toHaveAttribute('href', '/projects/p1/invoices');
    expect(within(nav).getByRole('link', { name: 'Change requests' })).toHaveAttribute(
      'href',
      '/projects/p1/change-requests',
    );
  });

  it('links built tabs, keeps the rest inert, and changes status with a reason', async () => {
    state.pathname = '/projects/p1/milestones';
    render(<ProjectHeader projectId={'p1' as never} permissions={PM} />);

    const nav = screen.getByRole('navigation', { name: 'Project sections' });
    expect(within(nav).getByRole('link', { name: 'Milestones and deliverables' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Billing tabs need billing permissions, which this project manager does not hold.
    expect(within(nav).queryByText('Invoices')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Change requests')).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Updates' })).not.toBeInTheDocument();
    expect(within(nav).getByText('Updates')).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    // Archiving needs projects.archive, and a planning project cannot be completed.
    expect(screen.queryByRole('menuitem', { name: 'Archived' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Active' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move to active' });
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Contract signed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change status' }));
    await waitFor(() =>
      expect(state.mutations['projects.setStatus']).toHaveBeenCalledWith({
        projectId: 'p1',
        status: 'active',
        reason: 'Contract signed',
      }),
    );
  });

  it('offers no editing without projects.update', () => {
    render(<ProjectHeader projectId={'p1' as never} permissions={MEMBER} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change status' })).not.toBeInTheDocument();
  });

  it('names the client without a link for a role that cannot open the CRM', () => {
    const { unmount } = render(<ProjectHeader projectId={'p1' as never} permissions={MEMBER} />);
    expect(screen.getByText(/UNB-P-0007/)).toHaveTextContent('Glossup');
    expect(screen.queryByRole('link', { name: 'Glossup' })).not.toBeInTheDocument();
    unmount();

    render(<ProjectHeader projectId={'p1' as never} permissions={PM} />);
    expect(screen.getByRole('link', { name: 'Glossup' })).toHaveAttribute('href', '/crm/clients/c1');
  });
});

describe('ProjectOverview', () => {
  it('lets anyone on the project add to its timeline, CRM or no CRM', () => {
    state.queries['milestones.listForProject'] = { milestones: [], unassigned: [] };
    state.queries['time.projectSummary'] = {
      scope: 'own',
      loggedMinutes: 0,
      billableMinutes: 0,
      approvedMinutes: 0,
      estimateMinutes: 0,
      missingRates: undefined,
    };
    render(<ProjectOverview projectId={'p1' as never} permissions={MEMBER} />);
    expect(screen.getByRole('form', { name: 'Add to the timeline' })).toBeInTheDocument();
  });
});

describe('MilestonesPanel', () => {
  beforeEach(() => {
    state.queries['milestones.listForProject'] = {
      milestones: [
        {
          id: 'ms1',
          name: 'Design',
          order: 0,
          dueDate: '2026-10-01',
          status: 'in_progress',
          billingAmountMinor: undefined,
          billingPercentBps: 3000,
          approvedAt: undefined,
          deliverables: [
            { id: 'd1', title: 'Figma file', status: 'draft', currentVersion: 0, approvedVersion: undefined },
          ],
        },
        {
          id: 'ms2',
          name: 'Build',
          order: 1,
          dueDate: undefined,
          status: 'approved',
          billingAmountMinor: 100_000_00,
          billingPercentBps: undefined,
          approvedAt: Date.parse('2026-09-10T10:00:00Z'),
          deliverables: [],
        },
      ],
      unassigned: [{ id: 'd2', title: 'Brand kit', status: 'approved', currentVersion: 2, approvedVersion: 2 }],
    };
  });

  it('shows milestones with their deliverables and moves one down', async () => {
    render(<MilestonesPanel projectId={'p1' as never} permissions={PM} />);

    expect(screen.getByText(/30% of the project/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Figma file/ })).toHaveAttribute('href', '/projects/p1/deliverables/d1');
    expect(screen.getByText('Without a milestone')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Move Design down' }));
    await waitFor(() =>
      expect(state.mutations['milestones.reorder']).toHaveBeenCalledWith({
        projectId: 'p1',
        milestoneIds: ['ms2', 'ms1'],
      }),
    );
  });

  it('keeps approved milestones out of the team’s hands and adds a deliverable', async () => {
    render(<MilestonesPanel projectId={'p1' as never} permissions={PM} />);

    // Approved milestones are the client's call: no status control, no delete.
    expect(screen.queryByLabelText('Status of Build')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status of Design'), 'skipped');
    await waitFor(() =>
      expect(state.mutations['milestones.setStatus']).toHaveBeenCalledWith({
        milestoneId: 'ms1',
        status: 'skipped',
      }),
    );

    await userEvent.click(screen.getAllByRole('button', { name: 'Add a deliverable' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New deliverable' });
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Prototype');
    expect(within(dialog).queryByRole('option', { name: 'Build' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add deliverable' }));
    await waitFor(() =>
      expect(state.mutations['deliverables.create']).toHaveBeenCalledWith({
        projectId: 'p1',
        title: 'Prototype',
        description: undefined,
        milestoneId: undefined,
      }),
    );
  });

  it('is read-only on a closed project', () => {
    state.queries['projects.get'] = project({ status: 'completed' });
    render(<MilestonesPanel projectId={'p1' as never} permissions={PM} />);
    expect(screen.queryByRole('button', { name: 'New milestone' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status of Design')).not.toBeInTheDocument();
  });
});

describe('MembersPanel', () => {
  it('adds a member, renames a role and never removes the manager', async () => {
    render(<MembersPanel projectId={'p1' as never} permissions={PM} />);

    const [manager] = screen.getAllByRole('listitem');
    expect(manager).toHaveTextContent('Tobi Ade');
    expect(manager).toHaveTextContent('Project manager');
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);

    await userEvent.selectOptions(screen.getByLabelText('Add someone'), 'mzuri');
    await userEvent.type(screen.getByLabelText('Project role (optional)'), 'QA');
    await userEvent.click(screen.getByRole('button', { name: 'Add to the project' }));
    await waitFor(() =>
      expect(state.mutations['projects.addProjectMember']).toHaveBeenCalledWith({
        projectId: 'p1',
        memberId: 'mzuri',
        projectRole: 'QA',
      }),
    );

    const role = screen.getByLabelText('Project role for Kemi Bello');
    await userEvent.clear(role);
    await userEvent.type(role, 'Lead designer');
    await userEvent.tab();
    await waitFor(() =>
      expect(state.mutations['projects.setMemberRole']).toHaveBeenCalledWith({
        projectId: 'p1',
        memberId: 'mkemi',
        projectRole: 'Lead designer',
      }),
    );
  });

  it('only lists members without projects.members.manage', () => {
    render(<MembersPanel projectId={'p1' as never} permissions={MEMBER} />);
    expect(screen.getByText('Kemi Bello')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add someone')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('DeliverableDetail', () => {
  beforeEach(() => {
    state.queries['deliverables.get'] = {
      id: 'd1',
      projectId: 'p1',
      milestone: { id: 'ms1', name: 'Design', status: 'in_progress' },
      title: 'Figma file',
      description: 'The full flow',
      status: 'changes_requested',
      currentVersion: 1,
      approvedVersion: undefined,
      approvedAt: undefined,
      approvedByName: undefined,
      versions: [
        {
          version: 1,
          notes: 'First pass',
          links: [{ label: 'Figma', url: 'https://figma.com/file/1' }],
          submittedAt: Date.parse('2026-09-10T10:00:00Z'),
          submittedByName: 'Kemi Bello',
          files: [{ id: 'f1', name: 'flow.pdf', sizeBytes: 2_400_000, mimeType: 'application/pdf' }],
        },
      ],
    };
    state.queries['comments.list'] = {
      canPostToClient: true,
      comments: [
        {
          id: 'cm1',
          body: 'Tightened the spacing',
          visibility: 'internal',
          authorKind: 'team',
          authorName: 'Kemi Bello',
          createdAt: Date.parse('2026-09-10T11:00:00Z'),
          editedAt: undefined,
          canEdit: false,
        },
      ],
    };
  });

  it('submits a version as a link and comments to the client', async () => {
    state.mutations['deliverables.submitVersion'] = vi.fn().mockResolvedValue({ ok: true, version: 2 });
    render(<DeliverableDetail deliverableId={'d1' as never} permissions={PM} />);

    expect(screen.getByText('Changes requested')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Figma' })).toHaveAttribute('href', 'https://figma.com/file/1');
    expect(screen.getByRole('button', { name: /flow\.pdf/ })).toHaveTextContent('2.3 MB');

    const form = screen.getByRole('form', { name: 'Submit a version' });
    await userEvent.click(within(form).getByRole('button', { name: 'Add a link' }));
    await userEvent.type(within(form).getByLabelText('Link 1 address'), 'https://figma.com/file/2');
    await userEvent.type(within(form).getByLabelText('Notes (optional)'), 'Spacing fixed');
    await userEvent.click(within(form).getByRole('button', { name: 'Submit for review' }));
    await waitFor(() =>
      expect(state.mutations['deliverables.submitVersion']).toHaveBeenCalledWith({
        deliverableId: 'd1',
        uploads: [],
        links: [{ label: undefined, url: 'https://figma.com/file/2' }],
        notes: 'Spacing fixed',
      }),
    );
    expect(await screen.findByText('Version 2 is with the client.')).toBeInTheDocument();

    const composer = screen.getByRole('form', { name: 'Add a comment' });
    await userEvent.type(within(composer).getByLabelText('Comment'), 'Ready for another look');
    await userEvent.selectOptions(within(composer).getByLabelText('Who can see it'), 'client');
    await userEvent.click(within(composer).getByRole('button', { name: 'Add comment' }));
    await waitFor(() =>
      expect(state.mutations['comments.add']).toHaveBeenCalledWith({
        target: { table: 'deliverables', id: 'd1' },
        body: 'Ready for another look',
        visibility: 'client',
      }),
    );
  });

  it('says why a version was refused and keeps the form', async () => {
    state.mutations['deliverables.submitVersion'] = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'files.tooLarge', message: 'Files here can be at most 100 MB' });
    render(<DeliverableDetail deliverableId={'d1' as never} permissions={PM} />);

    const form = screen.getByRole('form', { name: 'Submit a version' });
    await userEvent.click(within(form).getByRole('button', { name: 'Add a link' }));
    await userEvent.type(within(form).getByLabelText('Link 1 address'), 'https://figma.com/file/2');
    await userEvent.click(within(form).getByRole('button', { name: 'Submit for review' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Files here can be at most 100 MB');
  });

  it('hides submitting for someone who cannot manage deliverables', () => {
    render(<DeliverableDetail deliverableId={'d1' as never} permissions={['projects.view.assigned']} />);
    expect(screen.queryByRole('form', { name: 'Submit a version' })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add a comment' })).toBeInTheDocument();
  });
});

describe('ProjectSettings', () => {
  it('saves links and the SLA policy, keeping the rest of the project', async () => {
    render(<ProjectSettings projectId={'p1' as never} permissions={PM} />);

    await userEvent.type(screen.getByLabelText('Repository'), 'https://github.com/unbuilt/glossup');
    await userEvent.selectOptions(screen.getByLabelText('SLA policy'), 'sla1');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(state.mutations['projects.update']).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p1',
          name: 'Glossup app',
          slaPolicyId: 'sla1',
          links: {
            repo: 'https://github.com/unbuilt/glossup',
            staging: undefined,
            production: undefined,
            design: undefined,
          },
        }),
      ),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('tells someone who cannot change settings', () => {
    render(<ProjectSettings projectId={'p1' as never} permissions={MEMBER} />);
    expect(screen.getByText(/cannot change this project/)).toBeInTheDocument();
  });
});

describe('WinDealDialog', () => {
  const deal = {
    id: 'dl1',
    title: 'Glossup app',
    clientId: 'c1',
    currency: 'NGN',
    valueMinor: 250_000_00,
  } as unknown as WinnableDeal;

  it('wins a deal with a project the client already has', async () => {
    state.queries['projects.list'] = [project()];
    state.mutations['projects.winDealWithExistingProject'] = vi.fn().mockResolvedValue('p1');
    const onWon = vi.fn();
    render(<WinDealDialog deal={deal} canCreateProject canPickManager open onOpenChange={vi.fn()} onWon={onWon} />);

    await userEvent.selectOptions(screen.getByLabelText('Project'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Win the deal' }));
    await waitFor(() =>
      expect(state.mutations['projects.winDealWithExistingProject']).toHaveBeenCalledWith({
        dealId: 'dl1',
        projectId: 'p1',
      }),
    );
    expect(onWon).toHaveBeenCalledWith('p1');
  });

  it('wins a deal with a new project, starting from the deal', async () => {
    state.queries['projects.list'] = [];
    state.mutations['projects.winDealWithNewProject'] = vi.fn().mockResolvedValue('p9');
    render(<WinDealDialog deal={deal} canCreateProject canPickManager open onOpenChange={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Win Glossup app' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Glossup app');
    expect(within(dialog).getByLabelText('Budget (optional)')).toHaveValue('250000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Win the deal' }));
    await waitFor(() =>
      expect(state.mutations['projects.winDealWithNewProject']).toHaveBeenCalledWith(
        expect.objectContaining({ dealId: 'dl1', name: 'Glossup app', budgetMinor: 250_000_00 }),
      ),
    );
  });

  it('offers only the client’s projects without projects.create', () => {
    state.queries['projects.list'] = [project()];
    render(<WinDealDialog deal={deal} canCreateProject={false} canPickManager={false} open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('option', { name: 'Create a new project' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /UNB-P-0007/ })).toBeInTheDocument();
  });
});
