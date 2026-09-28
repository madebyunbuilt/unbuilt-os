import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentList } from './content-list';
import { PublishBar } from './publish-bar';
import { SeoFields } from './seo-fields';
import { WorkEditor } from './work-editor';

// The CMS screens (13-cms-and-website.md). What is checked here is what only exists on screen: the counts that keep
// text inside the website's limits, the reasons something cannot be published, and the wait before the site rebuilds.

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  push: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn().mockResolvedValue({ token: 'works.w1.123.sig' });
    return state.mutations[ref._name];
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/cms/works',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return { api: Object.fromEntries(['cms', 'cmsPublish', 'siteContent'].map((n) => [n, functions(n)])) };
});

const work = (overrides: object = {}) => ({
  _id: 'w1',
  slug: 'glossup',
  name: 'Glossup',
  art: '',
  listLine: 'A shop that loads fast',
  listDetail: 'Mobile app',
  seo: { title: '', description: '' },
  summary: 'A rebuild.',
  meta: { client: 'Glossup', year: '2026', role: 'Design and build', status: 'Delivered' },
  stack: ['Mobile app'],
  brief: [],
  hardPart: [],
  built: [],
  shots: [{ alt: '', caption: 'The app', frame: 'desktop' }],
  status: 'draft',
  projectId: 'p1',
  unpublishedChanges: false,
  blockers: [
    { field: 'title', message: 'An SEO title is needed' },
    { field: 'image', message: 'Choose the artwork for this case study: glossup, qravit, orrery, commit, pr' },
  ],
  revisions: [],
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
  state.queries = {
    'cms.get': work(),
    'cms.list': [],
    'cmsPublish.deployState': { batchSeconds: 60, pending: null, recent: [] },
  };
  state.mutations = {};
  state.push = vi.fn();
});

afterEach(() => vi.useRealTimers());

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe('the counts that keep text inside the website’s limits', () => {
  const Harness = ({ title = '', description = '' }) => (
    <SeoFields seo={{ title, description }} slug="glossup" onSeo={() => {}} onSlug={() => {}} />
  );

  it('counts up as it is typed, and says when it is too long', () => {
    const { rerender } = render(<Harness title="Short" />);
    expect(screen.getByText('5 of 44')).toBeInTheDocument();
    rerender(<Harness title={'x'.repeat(45)} />);
    expect(screen.getByText('45 of 44 — too long')).toBeInTheDocument();
  });

  it('says a description is still short of the minimum, not just that it is empty', () => {
    render(<Harness description={'x'.repeat(100)} />);
    expect(screen.getByText('100, needs 140')).toBeInTheDocument();
  });

  it('accepts a description inside the range without complaint', () => {
    render(<Harness description={'x'.repeat(150)} />);
    expect(screen.getByText('150 of 160')).toBeInTheDocument();
    expect(screen.queryByText(/too long/)).not.toBeInTheDocument();
  });

  it('warns that changing the address breaks links to the old one', () => {
    render(<Harness />);
    expect(screen.getByText(/anybody who linked to the old one will find nothing/)).toBeInTheDocument();
  });
});

describe('publishing', () => {
  const bar = (overrides: object = {}) =>
    render(
      <PublishBar
        table="works"
        id="w1"
        label="Glossup"
        status="draft"
        unpublishedChanges={false}
        blockers={[]}
        {...overrides}
      />,
    );

  it('will not publish while something is missing, and says what', () => {
    bar({ blockers: [{ field: 'title', message: 'An SEO title is needed' }] });
    expect(screen.getByRole('button', { name: /^Publish/ })).toBeDisabled();
    expect(screen.getByText('An SEO title is needed')).toBeInTheDocument();
  });

  it('publishes when nothing is in the way', async () => {
    bar();
    await user().click(screen.getByRole('button', { name: /^Publish/ }));
    await waitFor(() =>
      expect(state.mutations['cmsPublish.publish']).toHaveBeenCalledWith({ table: 'works', id: 'w1' }),
    );
  });

  it('counts down to the rebuild, so the wait is not silence', () => {
    state.queries['cmsPublish.deployState'] = {
      batchSeconds: 60,
      pending: {
        id: 'p1',
        changes: [{ label: 'Glossup', action: 'published' }],
        requestedAt: Date.now(),
        deployAt: Date.now() + 45_000,
      },
      recent: [],
    };
    bar();
    expect(screen.getByText(/1 change/)).toBeInTheDocument();
    expect(screen.getByText(/in 45s/)).toBeInTheDocument();
  });

  it('offers to rebuild without waiting', async () => {
    state.queries['cmsPublish.deployState'] = {
      batchSeconds: 60,
      pending: { id: 'p1', changes: [], requestedAt: Date.now(), deployAt: Date.now() + 45_000 },
      recent: [],
    };
    bar();
    await user().click(screen.getByRole('button', { name: 'Rebuild now' }));
    await waitFor(() => expect(state.mutations['cmsPublish.deployNow']).toHaveBeenCalled());
  });

  it('says plainly when the last rebuild did not happen', () => {
    state.queries['cmsPublish.deployState'] = {
      batchSeconds: 60,
      pending: null,
      recent: [{ id: 'd1', status: 'failed', error: 'The deploy hook answered 503', changes: [] }],
    };
    bar();
    // The distinction that matters: the content is published, the website is not showing it.
    expect(screen.getByText(/The content is published; the website has not caught up/)).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it('offers taking something down only once it is up', () => {
    bar();
    expect(screen.queryByRole('button', { name: 'Take it down' })).not.toBeInTheDocument();
    bar({ status: 'published' });
    expect(screen.getByRole('button', { name: 'Take it down' })).toBeInTheDocument();
  });

  it('marks a published item that has been edited since', () => {
    bar({ status: 'published', unpublishedChanges: true });
    expect(screen.getByText('Edited since it went out')).toBeInTheDocument();
  });
});

describe('writing a case study', () => {
  it('shows why it cannot be published yet', () => {
    render(<WorkEditor workId={'w1' as never} />);
    expect(screen.getByText('An SEO title is needed')).toBeInTheDocument();
    expect(screen.getByText(/Choose the artwork/)).toBeInTheDocument();
  });

  it('explains that the artwork list is the website’s code, not a setting', () => {
    render(<WorkEditor workId={'w1' as never} />);
    expect(screen.getByText(/Adding another one is a change in the website’s code/)).toBeInTheDocument();
  });

  it('asks for alt text on every screenshot, and says why', () => {
    render(<WorkEditor workId={'w1' as never} />);
    expect(screen.getByLabelText('Alt text')).toHaveValue('');
    expect(screen.getByText(/for somebody who cannot see it/)).toBeInTheDocument();
  });

  it('does not write on every keystroke, and saves once asked', async () => {
    render(<WorkEditor workId={'w1' as never} />);
    const name = screen.getByLabelText('Name');
    await user().clear(name);
    await user().type(name, 'Glossup shop');
    // The mock exists from the first render, so what matters is that nothing called it while typing.
    expect(state.mutations['cms.updateWork']).not.toHaveBeenCalled();

    await user().click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.mutations['cms.updateWork']).toHaveBeenCalledWith(
        expect.objectContaining({ workId: 'w1', name: 'Glossup shop' }),
      ),
    );
  });

  it('drops the empty lines somebody added and did not fill in', async () => {
    render(<WorkEditor workId={'w1' as never} />);
    const section = screen.getByText('The brief').closest('div')!;
    await user().click(within(section).getByRole('button', { name: 'Add a line' }));
    await user().type(screen.getByLabelText('The brief 1'), 'Make it fast');
    await user().click(within(section).getByRole('button', { name: 'Add a line' }));

    await user().click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.mutations['cms.updateWork']).toHaveBeenCalledWith(
        expect.objectContaining({ brief: ['Make it fast'] }),
      ),
    );
  });

  it('asks for the client’s permission before it can go out, and can take it back', async () => {
    render(<WorkEditor workId={'w1' as never} />);
    expect(screen.getByText(/the client’s story as much as Unbuilt’s/)).toBeInTheDocument();
    await user().type(screen.getByLabelText('How they said it'), 'Said yes on a call');
    await user().click(screen.getByRole('button', { name: 'Record their permission' }));
    await waitFor(() =>
      expect(state.mutations['cms.recordClientPermission']).toHaveBeenCalledWith({
        workId: 'w1',
        granted: true,
        note: 'Said yes on a call',
      }),
    );

    state.queries['cms.get'] = work({ clientPermission: { grantedAt: Date.now(), note: 'Said yes on a call' } });
    render(<WorkEditor workId={'w1' as never} />);
    expect(screen.getAllByRole('button', { name: 'Take it back' })[0]).toBeInTheDocument();
  });

  it('says when a save was refused, rather than looking like it worked', async () => {
    render(<WorkEditor workId={'w1' as never} />);
    state.mutations['cms.updateWork'] = vi
      .fn()
      .mockRejectedValue(new ConvexError({ code: 'cms.slugTaken', message: 'Something else already uses that slug' }));
    await user().type(screen.getByLabelText('Name'), '!');
    await user().click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/already uses that slug/)).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('separates published from published-with-edits-waiting', () => {
    state.queries['cms.list'] = [
      {
        id: 'a',
        label: 'Live',
        slug: 'live',
        status: 'published',
        draftUpdatedAt: Date.now(),
        unpublishedChanges: false,
      },
      {
        id: 'b',
        label: 'Edited',
        slug: 'edited',
        status: 'published',
        draftUpdatedAt: Date.now(),
        unpublishedChanges: true,
      },
    ];
    render(<ContentList table="works" />);
    const edited = screen.getByText('Edited').closest('a')!;
    expect(within(edited).getByText('Edits waiting')).toBeInTheDocument();
    const live = screen.getByText('Live').closest('a')!;
    expect(within(live).queryByText('Edits waiting')).not.toBeInTheDocument();
  });

  it('says there is nothing rather than showing an empty table', () => {
    render(<ContentList table="works" />);
    expect(screen.getByText(/No case studies yet/)).toBeInTheDocument();
  });
});
