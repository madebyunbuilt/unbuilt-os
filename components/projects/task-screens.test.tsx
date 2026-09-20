import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MyTasks } from './my-tasks';
import { TaskBoard } from './task-board';

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  replace: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => {
    if (args === 'skip') return undefined;
    state.queryArgs[ref._name] = args;
    return state.queries[ref._name];
  },
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue(undefined);
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace, refresh: vi.fn() }),
  usePathname: () => '/projects/p1/tasks',
  useSearchParams: () => state.params,
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return {
    api: Object.fromEntries(
      ['projects', 'milestones', 'tasks', 'comments', 'team'].map((name) => [name, functions(name)]),
    ),
  };
});

const task = (overrides: object = {}) => ({
  id: 't1',
  projectId: 'p1',
  milestone: { id: 'ms1', name: 'Design' },
  title: 'Wire up the booking flow',
  description: 'Start from the Figma file.',
  status: 'todo',
  priority: 'high',
  assignees: [{ id: 'mkemi', name: 'Kemi Bello' }],
  dueDate: '2026-09-30',
  estimateMinutes: 90,
  order: 0,
  completedAt: undefined,
  ...overrides,
});

const PM = ['projects.view.assigned', 'projects.update', 'tasks.manage.all', 'team.view'];
const MEMBER = ['projects.view.assigned'];

beforeEach(() => {
  state.queries = {
    'projects.get': {
      id: 'p1',
      status: 'active',
      members: [
        { memberId: 'm_tobi', name: 'Tobi Ade', isManager: true, status: 'active' },
        { memberId: 'mkemi', name: 'Kemi Bello', isManager: false, status: 'active' },
      ],
    },
    'milestones.listForProject': {
      milestones: [{ id: 'ms1', name: 'Design', status: 'in_progress', deliverables: [] }],
      unassigned: [],
    },
    'tasks.listForProject': [task(), task({ id: 't2', title: 'Ship the API', status: 'in_progress', order: 0 })],
    'comments.list': { canPostToClient: true, comments: [] },
  };
  state.queryArgs = {};
  state.mutations = {};
  state.replace.mockClear();
  state.params = new URLSearchParams();
});

describe('TaskBoard', () => {
  it('shows the columns, filters and moves a task', async () => {
    render(<TaskBoard projectId={'p1' as never} permissions={PM} />);

    const todo = screen.getByRole('listitem', { name: 'To do' });
    expect(todo).toHaveTextContent('Wire up the booking flow');
    expect(screen.getByRole('listitem', { name: 'In progress' })).toHaveTextContent('Ship the API');

    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'mkemi');
    expect(state.queryArgs['tasks.listForProject']).toMatchObject({ assigneeMemberId: 'mkemi' });
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high');
    expect(state.queryArgs['tasks.listForProject']).toMatchObject({ priority: 'high' });

    await userEvent.selectOptions(screen.getByLabelText('Move Wire up the booking flow'), 'done');
    await waitFor(() => expect(state.mutations['tasks.move']).toHaveBeenCalledWith({ taskId: 't1', status: 'done' }));
  });

  it('adds a task to a column with an estimate in hours', async () => {
    render(<TaskBoard projectId={'p1' as never} permissions={PM} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add to blocked' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Chase the API keys');
    await userEvent.type(within(dialog).getByLabelText('Estimate in hours (optional)'), '1.5');
    await userEvent.click(within(dialog).getByLabelText('Kemi Bello'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add task' }));

    await waitFor(() =>
      expect(state.mutations['tasks.create']).toHaveBeenCalledWith({
        projectId: 'p1',
        status: 'blocked',
        title: 'Chase the API keys',
        description: undefined,
        milestoneId: undefined,
        priority: 'medium',
        assigneeMemberIds: ['mkemi'],
        dueDate: undefined,
        estimateMinutes: 90,
      }),
    );
  });

  it('says so when the estimate is not a number', async () => {
    render(<TaskBoard projectId={'p1' as never} permissions={PM} />);
    await userEvent.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Chase the API keys');
    await userEvent.type(within(dialog).getByLabelText('Estimate in hours (optional)'), 'half a day');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add task' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Give the hours as a number');
    expect(state.mutations['tasks.create']).not.toHaveBeenCalled();
  });

  it('opens a task at once and puts it in the address bar', async () => {
    render(<TaskBoard projectId={'p1' as never} permissions={PM} />);
    await userEvent.click(screen.getByRole('button', { name: /Wire up the booking flow/ }));

    // The panel must not wait on a router navigation to the same page.
    expect(await screen.findByRole('dialog', { name: 'Wire up the booking flow' })).toBeInTheDocument();
    expect(window.location.search).toBe('?task=t1');
    expect(state.replace).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).toBe('');
  });

  it('shows the task a mention linked to, with its comments', async () => {
    state.params = new URLSearchParams('task=t1');
    render(<TaskBoard projectId={'p1' as never} permissions={PM} />);

    const panel = await screen.findByRole('dialog', { name: 'Wire up the booking flow' });
    expect(panel).toHaveTextContent('Start from the Figma file.');
    expect(panel).toHaveTextContent('Kemi Bello');
    expect(panel).toHaveTextContent('Estimate 1.5h');
    expect(within(panel).getByRole('form', { name: 'Add a comment' })).toBeInTheDocument();
  });

  it('is read-only for someone who cannot manage tasks', () => {
    render(<TaskBoard projectId={'p1' as never} permissions={MEMBER} />);
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Move Wire up the booking flow')).not.toBeInTheDocument();
  });

  it('is read-only on a closed project', () => {
    state.queries['projects.get'] = { id: 'p1', status: 'completed', members: [] };
    render(<TaskBoard projectId={'p1' as never} permissions={PM} />);
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add to/ })).not.toBeInTheDocument();
  });
});

describe('MyTasks', () => {
  it('lists your open tasks, overdue ones marked, and links to the board', () => {
    state.queries['tasks.mine'] = [
      { ...task({ dueDate: '2026-09-01' }), projectCode: 'UNB-P-0007', projectName: 'Glossup app' },
    ];
    render(<MyTasks />);
    const [row] = screen.getAllByRole('listitem');
    expect(row).toHaveTextContent('Was due 1 Sep 2026');
    expect(within(row).getByRole('link')).toHaveAttribute('href', '/projects/p1/tasks?task=t1');
  });

  it('says so when nothing is open', () => {
    state.queries['tasks.mine'] = [];
    render(<MyTasks />);
    expect(screen.getByText('Nothing assigned to you is open.')).toBeInTheDocument();
  });
});
