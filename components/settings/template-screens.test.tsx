import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClauseLibrary } from './clause-library';
import { TemplateEditor } from './template-editor';
import { TemplateList } from './template-list';

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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/document-templates',
}));
vi.mock('@/convex/_generated/api', () => {
  const functions = (name: string) => new Proxy({}, { get: (_, fn: string) => ({ _name: `${name}.${fn}` }) });
  return { api: { documentTemplates: functions('documentTemplates'), clauses: functions('clauses') } };
});

const template = (overrides: object = {}) => ({
  id: 't1',
  type: 'quote',
  name: 'Quote',
  description: 'A price for defined work',
  version: 3,
  blocks: [
    { kind: 'heading', text: 'What this covers', level: 1 },
    { kind: 'paragraph', text: 'Prepared for {{contact.name}}.' },
    { kind: 'clause', clauseKey: 'payment-terms' },
    { kind: 'lineItems' },
    { kind: 'totals' },
    { kind: 'signature', party: 'client' },
    { kind: 'signature', party: 'studio' },
  ],
  variables: ['contact.name'],
  isDefault: true,
  requiresLegalReview: false,
  active: true,
  ...overrides,
});

const clause = (overrides: object = {}) => ({
  id: 'cl1',
  key: 'payment-terms',
  title: 'Payment',
  body: 'Invoices are payable in {{totals.currency}}.',
  category: 'Money',
  version: 1,
  active: true,
  ...overrides,
});

beforeEach(() => {
  state.queries = {
    'documentTemplates.list': [
      template(),
      template({ id: 't2', name: 'Short quote', isDefault: false, version: 1 }),
      template({ id: 't3', type: 'contract', name: 'Master services agreement', requiresLegalReview: true }),
    ],
    'clauses.list': [clause(), clause({ id: 'cl2', key: 'governing-law', title: 'Governing law', category: 'Legal' })],
  };
  state.queryArgs = {};
  state.mutations = {};
  state.push.mockClear();
});

describe('TemplateList', () => {
  it('groups templates by type and marks the default and the legal ones', () => {
    render(<TemplateList />);
    expect(screen.getByRole('heading', { name: 'Quote' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contract' })).toBeInTheDocument();

    const legal = screen.getByRole('link', { name: 'Master services agreement' }).closest('li')!;
    expect(legal).toHaveTextContent('Needs legal review');
    expect(screen.getByRole('link', { name: 'Quote' }).closest('li')).toHaveTextContent('Default');
  });

  it('makes another template the default and retires one', async () => {
    render(<TemplateList />);
    const short = screen.getByRole('link', { name: 'Short quote' }).closest('li')!;
    await userEvent.click(within(short).getByRole('button', { name: 'Make default' }));
    expect(state.mutations['documentTemplates.setDefault']).toHaveBeenCalledWith({ templateId: 't2' });

    await userEvent.click(within(short).getByRole('button', { name: 'Retire' }));
    expect(state.mutations['documentTemplates.setActive']).toHaveBeenCalledWith({ templateId: 't2', active: false });
  });
});

describe('TemplateEditor', () => {
  it('reorders and edits blocks, then saves a new version', async () => {
    state.mutations['documentTemplates.update'] = vi.fn().mockResolvedValue({ version: 4 });
    render(<TemplateEditor template={template() as never} />);

    const blocks = screen.getByRole('list', { name: 'Blocks' });
    // Signatures are told apart by whose they are.
    expect(blocks).toHaveTextContent('Client signature');
    expect(blocks).toHaveTextContent('Studio signature');

    await userEvent.clear(screen.getByLabelText('Block 2 paragraph'));
    await userEvent.type(screen.getByLabelText('Block 2 paragraph'), 'For {{{{client.displayName}}');
    await userEvent.click(screen.getByRole('button', { name: 'Move block 2 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save the template' }));

    await waitFor(() =>
      expect(state.mutations['documentTemplates.update']).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 't1',
          blocks: expect.arrayContaining([{ kind: 'paragraph', text: 'For {{client.displayName}}' }]),
        }),
      ),
    );
    const saved = state.mutations['documentTemplates.update'].mock.calls[0][0].blocks;
    expect(saved[0]).toEqual({ kind: 'paragraph', text: 'For {{client.displayName}}' });
    expect(await screen.findByText('Saved as version 4.')).toBeInTheDocument();
  });

  it('adds a clause block and picks the clause', async () => {
    render(<TemplateEditor template={template() as never} />);
    await userEvent.selectOptions(screen.getByLabelText('Add a block'), 'Clause');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.selectOptions(screen.getByLabelText('Block 8 clause'), 'governing-law');
    await userEvent.click(screen.getByRole('button', { name: 'Save the template' }));
    await waitFor(() => {
      const saved = state.mutations['documentTemplates.update'].mock.calls[0][0].blocks;
      expect(saved.at(-1)).toEqual({ kind: 'clause', clauseKey: 'governing-law' });
    });
  });

  it('shows the server’s reason when a variable is unknown', async () => {
    state.mutations['documentTemplates.update'] = vi.fn().mockRejectedValue(
      new ConvexError({
        code: 'documents.unknownVariable',
        message: 'The template "Quote" uses {{clinet.name}}, which the app cannot fill in',
      }),
    );
    render(<TemplateEditor template={template() as never} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save the template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('{{clinet.name}}');
  });

  it('warns that a legal template needs a lawyer', () => {
    render(<TemplateEditor template={template({ requiresLegalReview: true, type: 'contract' }) as never} />);
    expect(screen.getByText(/Have your lawyer read it/)).toBeInTheDocument();
  });

  it('says a priced template needs its totals before it can be saved', async () => {
    render(<TemplateEditor template={template() as never} />);
    expect(screen.queryByText(/needs a totals block/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove block 5' }));
    expect(screen.getByText(/needs a totals block/)).toBeInTheDocument();
  });

  it('creates a template and opens it', async () => {
    state.mutations['documentTemplates.create'] = vi.fn().mockResolvedValue('t9');
    render(<TemplateEditor />);
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'nda');
    await userEvent.type(screen.getByLabelText('Name'), 'Short NDA');
    await userEvent.selectOptions(screen.getByLabelText('Add a block'), 'Paragraph');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.type(screen.getByLabelText('Block 1 paragraph'), 'Keep it private.');
    await userEvent.click(screen.getByRole('button', { name: 'Create the template' }));

    await waitFor(() =>
      expect(state.mutations['documentTemplates.create']).toHaveBeenCalledWith({
        type: 'nda',
        name: 'Short NDA',
        description: undefined,
        blocks: [{ kind: 'paragraph', text: 'Keep it private.' }],
      }),
    );
    expect(state.push).toHaveBeenCalledWith('/settings/document-templates/t9');
  });
});

describe('ClauseLibrary', () => {
  it('groups clauses by category and rewords one', async () => {
    state.mutations['clauses.update'] = vi.fn().mockResolvedValue({ version: 2 });
    render(<ClauseLibrary />);
    expect(screen.getByRole('heading', { name: 'Money' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Legal' })).toBeInTheDocument();

    const payment = screen.getByText('Payment').closest('li')!;
    await userEvent.click(within(payment).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Payment' });
    expect(dialog).toHaveTextContent('Changing the wording makes version 2');
    await userEvent.clear(within(dialog).getByLabelText('Wording'));
    await userEvent.type(within(dialog).getByLabelText('Wording'), 'Payable within 14 days.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save clause' }));

    await waitFor(() =>
      expect(state.mutations['clauses.update']).toHaveBeenCalledWith({
        clauseId: 'cl1',
        title: 'Payment',
        body: 'Payable within 14 days.',
        category: 'Money',
      }),
    );
  });

  it('explains when a clause cannot be retired because a template uses it', async () => {
    state.mutations['clauses.setActive'] = vi
      .fn()
      .mockRejectedValue(new ConvexError({ code: 'documents.clauseInUse', message: 'Quote still uses this clause' }));
    render(<ClauseLibrary />);
    const payment = screen.getByText('Payment').closest('li')!;
    await userEvent.click(within(payment).getByRole('button', { name: 'Retire' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Quote still uses this clause');
  });
});
