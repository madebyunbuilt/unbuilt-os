import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientHeader } from './client-header';
import { ClientList } from './client-list';
import { ClientSettings } from './client-settings';
import { ContactsPanel } from './contacts-panel';
import { RateCard } from './rate-card';
import { Timeline } from './timeline';

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  pages: [] as unknown[],
  push: vi.fn(),
  pathname: '/crm/clients/c1',
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
      clients: functions('clients'),
      contacts: functions('contacts'),
      activities: functions('activities'),
      rateCard: functions('rateCard'),
      deals: functions('deals'),
      team: functions('team'),
    },
  };
});

const client = (overrides: object = {}) => ({
  id: 'c1',
  displayName: 'Glossup',
  legalName: 'Glossup Limited',
  kind: 'company',
  status: 'lead',
  industry: 'Beauty',
  website: 'https://glossup.com',
  country: 'NG',
  addressLines: ['12 Admiralty Way', 'Lekki'],
  tin: '1234',
  vatTreatment: 'standard',
  whtApplies: false,
  defaultCurrency: 'NGN',
  timezone: 'Africa/Lagos',
  ownerMemberId: 'm_tobi',
  ownerName: 'Tobi Ade',
  tags: ['retainer'],
  portalEnabled: false,
  createdAt: Date.parse('2026-09-01T09:00:00Z'),
  primaryContact: { id: 'ct1', name: 'Ada Obi', email: 'ada@glossup.com' },
  contactCount: 1,
  ...overrides,
});

const contact = (overrides: object = {}) => ({
  id: 'ct1',
  clientId: 'c1',
  name: 'Ada Obi',
  email: 'ada@glossup.com',
  jobTitle: 'Founder',
  phone: undefined,
  whatsapp: '+2348012345678',
  whatsappOptIn: null,
  isPrimary: true,
  isBilling: true,
  portalAccess: false,
  portalRole: null,
  hasSignedIn: false,
  status: 'active',
  ...overrides,
});

const PM = ['clients.view', 'clients.create', 'clients.update', 'contacts.manage', 'deals.view', 'team.view'];
const FINANCE = ['clients.view', 'deals.view', 'invoices.view', 'invoices.update', 'team.view'];

beforeEach(() => {
  state.queries = {
    'clients.facets': { tags: ['retainer', 'saas'], industries: ['Beauty'] },
    'clients.get': client(),
    'contacts.portalRoles': [
      { id: 'r_admin', key: 'client_admin', name: 'Client admin', description: 'Everything in the portal' },
      { id: 'r_member', key: 'client_member', name: 'Client member', description: 'Projects and documents' },
    ],
    'team.list': [
      { id: 'm_tobi', name: 'Tobi Ade', status: 'active' },
      { id: 'mkemi', name: 'Kemi Bello', status: 'active' },
    ],
    'clients.slaPolicyOptions': [{ id: 'sla1', name: 'Standard' }],
  };
  state.queryArgs = {};
  state.mutations = {};
  state.pages = [];
  state.push.mockClear();
  state.pathname = '/crm/clients/c1';
});

describe('ClientList', () => {
  it('filters clients and creates a new one, opening its page', async () => {
    state.queries['clients.list'] = [client()];
    render(<ClientList canCreate canViewTeam />);

    expect(screen.getByRole('link', { name: /Glossup/ })).toHaveAttribute('href', '/crm/clients/c1');
    expect(screen.getByRole('row', { name: /Glossup/ })).toHaveTextContent('Ada Obi');
    await userEvent.selectOptions(screen.getByLabelText('Tag'), 'saas');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'lead');
    expect(state.queryArgs['clients.list']).toMatchObject({ tag: 'saas', status: 'lead' });

    state.mutations['clients.create'] = vi.fn().mockResolvedValue('c2');
    await userEvent.click(screen.getByRole('button', { name: 'New client' }));
    const dialog = await screen.findByRole('dialog', { name: 'New client' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create client' }));
    expect(await within(dialog).findByText('Name the client')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Qravit');
    await userEvent.type(within(dialog).getByLabelText('Tags (optional)'), 'saas, retainer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create client' }));
    await waitFor(() =>
      expect(state.mutations['clients.create']).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Qravit',
          kind: 'company',
          tags: ['saas', 'retainer'],
          ownerMemberId: undefined,
        }),
      ),
    );
    expect(state.push).toHaveBeenCalledWith('/crm/clients/c2');
  });

  it('hides creating clients without clients.create', () => {
    state.queries['clients.list'] = [];
    render(<ClientList canCreate={false} canViewTeam={false} />);
    expect(screen.queryByRole('button', { name: 'New client' })).not.toBeInTheDocument();
    expect(screen.getByText('No clients yet.')).toBeInTheDocument();
  });
});

describe('ClientHeader', () => {
  it('links built tabs, hides what the role cannot see, and offers editing only with clients.update', () => {
    state.pathname = '/crm/clients/c1/contacts';
    const { unmount } = render(<ClientHeader clientId={'c1' as never} permissions={PM} />);
    const nav = screen.getByRole('navigation', { name: 'Client sections' });
    expect(within(nav).getByRole('link', { name: 'Contacts' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    // No Files tab at all: the studio decided against one (18-open-questions.md), so it is gone rather than inert.
    expect(within(nav).queryByText('Files')).not.toBeInTheDocument();
    // Invoices show only to roles that can see them.
    expect(within(nav).queryByText('Invoices and payments')).not.toBeInTheDocument();
    // Vault shows only to roles that can see vault items, and tickets only to roles that can see tickets.
    expect(within(nav).queryByText('Vault')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Tickets')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    unmount();

    render(<ClientHeader clientId={'c1' as never} permissions={FINANCE} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Invoices and payments' })).toHaveAttribute(
      'href',
      '/crm/clients/c1/invoices',
    );
  });
});

describe('ContactsPanel', () => {
  it('adds a contact and gives portal access with the automatic role', async () => {
    state.queries['contacts.listForClient'] = [contact()];
    render(<ContactsPanel clientId={'c1' as never} permissions={PM} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a contact' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Bayo');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'bayo@glossup.com');
    await userEvent.click(within(dialog).getByLabelText('Billing contact (receives invoices)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));
    await waitFor(() =>
      expect(state.mutations['contacts.create']).toHaveBeenCalledWith({
        clientId: 'c1',
        name: 'Bayo',
        email: 'bayo@glossup.com',
        jobTitle: undefined,
        phone: undefined,
        whatsapp: undefined,
        isBilling: true,
      }),
    );

    const card = screen.getByRole('listitem', { name: 'Ada Obi' });
    expect(card).toHaveTextContent('No opt-in');
    await userEvent.click(within(card).getByRole('button', { name: 'Give portal access' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Give Ada Obi portal access?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Give access and send invite' }));
    await waitFor(() =>
      expect(state.mutations['contacts.grantPortalAccess']).toHaveBeenCalledWith({
        contactId: 'ct1',
        roleId: undefined,
      }),
    );
  });

  it('records WhatsApp consent and marks people as left', async () => {
    state.queries['contacts.listForClient'] = [contact()];
    render(<ContactsPanel clientId={'c1' as never} permissions={PM} />);
    const card = screen.getByRole('listitem', { name: 'Ada Obi' });

    await userEvent.click(within(card).getByRole('button', { name: 'Record WhatsApp opt-in' }));
    const optIn = await screen.findByRole('alertdialog');
    await userEvent.selectOptions(within(optIn).getByLabelText('How they agreed'), 'form');
    await userEvent.click(within(optIn).getByRole('button', { name: 'Record opt-in' }));
    await waitFor(() =>
      expect(state.mutations['contacts.recordWhatsappOptIn']).toHaveBeenCalledWith({
        contactId: 'ct1',
        method: 'form',
      }),
    );

    await userEvent.click(within(card).getByRole('button', { name: 'Mark as left' }));
    const left = await screen.findByRole('alertdialog', { name: 'Has Ada Obi left?' });
    await userEvent.click(within(left).getByRole('button', { name: 'Mark as left' }));
    await waitFor(() => expect(state.mutations['contacts.markLeft']).toHaveBeenCalledWith({ contactId: 'ct1' }));
  });

  it('shows portal status and no actions without contacts.manage', () => {
    state.queries['contacts.listForClient'] = [
      contact({
        portalAccess: true,
        portalRole: { id: 'r_admin', key: 'client_admin', name: 'Client admin' },
        hasSignedIn: true,
      }),
    ];
    render(<ContactsPanel clientId={'c1' as never} permissions={FINANCE} />);
    const card = screen.getByRole('listitem', { name: 'Ada Obi' });
    expect(card).toHaveTextContent('Client adminSigned in');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument();
  });
});

describe('Timeline', () => {
  it('adds a note with an @mention as markup and renders mentions by name', async () => {
    state.pages = [
      {
        id: 'a1',
        type: 'note',
        title: 'Note',
        body: 'Ask @[Kemi Bello](member:mkemi) about the invoice',
        actorName: 'Funmi',
        occurredAt: Date.parse('2026-09-10T10:00:00Z'),
        canEdit: true,
        canDelete: true,
      },
      {
        id: 'a2',
        type: 'status_change',
        title: 'Status changed from Lead to Active',
        actorName: 'Tobi Ade',
        occurredAt: Date.parse('2026-09-09T10:00:00Z'),
        canEdit: false,
        canDelete: false,
      },
    ];
    render(<Timeline subject={{ table: 'clients', id: 'c1' }} canAdd canMention />);

    const [note, status] = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem');
    expect(note).toHaveTextContent('Ask @Kemi Bello about the invoice');
    expect(within(status).queryByRole('button')).not.toBeInTheDocument();

    const composer = screen.getByRole('form', { name: 'Add to the timeline' });
    await userEvent.type(within(composer).getByLabelText('Note'), 'Please follow up');
    await userEvent.click(within(composer).getByRole('button', { name: 'Mention someone' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Kemi Bello' }));
    await userEvent.click(within(composer).getByRole('button', { name: 'Add note' }));
    await waitFor(() =>
      expect(state.mutations['activities.add']).toHaveBeenCalledWith({
        subject: { table: 'clients', id: 'c1' },
        type: 'note',
        title: undefined,
        body: 'Please follow up @[Kemi Bello](member:mkemi) ',
        occurredAt: undefined,
      }),
    );

    await userEvent.click(within(note).getByRole('button', { name: /Delete/ }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(state.mutations['activities.remove']).toHaveBeenCalledWith({ activityId: 'a1' }));
  });
});

describe('ClientSettings', () => {
  it('shows billing details read-only to project managers', () => {
    render(<ClientSettings clientId={'c1' as never} permissions={PM} />);
    expect(screen.getByLabelText('Legal name')).toBeDisabled();
    expect(screen.getByText(/Only the Owner, Admins and Finance/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete client' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive client' })).toBeInTheDocument();
  });

  it('lets Finance save billing details with WHT as basis points', async () => {
    render(<ClientSettings clientId={'c1' as never} permissions={FINANCE} />);
    await userEvent.selectOptions(screen.getByLabelText('VAT treatment'), 'zero_rated');
    await userEvent.click(screen.getByLabelText('The client deducts withholding tax'));
    await userEvent.clear(screen.getByLabelText('WHT rate (%)'));
    await userEvent.type(screen.getByLabelText('WHT rate (%)'), '7.5');
    await userEvent.type(screen.getByLabelText('Payment terms (days)'), '14');
    await userEvent.click(screen.getByRole('button', { name: 'Save billing details' }));
    await waitFor(() =>
      expect(state.mutations['clients.updateBilling']).toHaveBeenCalledWith({
        clientId: 'c1',
        legalName: 'Glossup Limited',
        addressLines: ['12 Admiralty Way', 'Lekki'],
        tin: '1234',
        vatTreatment: 'zero_rated',
        whtApplies: true,
        whtBps: 750,
        defaultCurrency: 'NGN',
        paymentTermsDays: 14,
      }),
    );
    expect(screen.getByLabelText('SLA policy')).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('Payment terms (days)'));
    await userEvent.type(screen.getByLabelText('Payment terms (days)'), 'two weeks');
    await userEvent.click(screen.getByRole('button', { name: 'Save billing details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment terms must be a whole number of days');
  });
});

describe('RateCard', () => {
  it('adds an item with prices in minor units and retires items', async () => {
    state.queries['rateCard.list'] = [
      {
        id: 'i1',
        name: 'Product design',
        unit: 'day',
        prices: [{ currency: 'NGN', unitPriceMinor: 45_000_000 }],
        taxable: true,
        active: true,
      },
    ];
    render(<RateCard canManage />);
    const row = screen.getByRole('row', { name: /Product design/ });
    expect(row).toHaveTextContent('Per day');
    expect(row).toHaveTextContent('450,000.00');

    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a rate card item' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Backend hour');
    await userEvent.selectOptions(within(dialog).getByLabelText('Unit'), 'hour');
    await userEvent.type(within(dialog).getByLabelText('USD'), '75.50');
    await userEvent.click(within(dialog).getByLabelText('VAT applies'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    await waitFor(() =>
      expect(state.mutations['rateCard.create']).toHaveBeenCalledWith({
        name: 'Backend hour',
        description: undefined,
        category: undefined,
        unit: 'hour',
        taxable: false,
        prices: [{ currency: 'USD', unitPriceMinor: 7550 }],
      }),
    );

    await userEvent.click(within(row).getByRole('button', { name: 'Retire Product design' }));
    expect(state.mutations['rateCard.setActive']).toHaveBeenCalledWith({ itemId: 'i1', active: false });
  });
});
