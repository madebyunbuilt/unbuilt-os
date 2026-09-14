import { type Surface } from '@/lib/surface';

// Navigation for both surfaces. An item shows when the role holds any of its permissions. Items for modules that are
// not built yet stay visible but inert, in the "not built yet" style (docs/spec/01-product.md, Design), so the menu
// never links to a page that does not exist.

export type NavIcon =
  | 'home'
  | 'inbox'
  | 'handshake'
  | 'building'
  | 'folder'
  | 'file'
  | 'receipt'
  | 'wallet'
  | 'truck'
  | 'lifebuoy'
  | 'activity'
  | 'key'
  | 'users'
  | 'globe'
  | 'chart'
  | 'settings';

export type NavItem = {
  label: string;
  href: string;
  icon: NavIcon;
  /** Shown when the role holds any of these. Omitted: shown to everyone on the surface. */
  anyOf?: readonly string[];
  /** False until the module's pages exist. */
  built: boolean;
};

export type NavSection = { label?: string; items: readonly NavItem[] };

export const TEAM_NAVIGATION: readonly NavSection[] = [
  { items: [{ label: 'Home', href: '/', icon: 'home', built: true }] },
  {
    label: 'CRM',
    items: [
      { label: 'Enquiries', href: '/crm/enquiries', icon: 'inbox', anyOf: ['enquiries.view'], built: false },
      { label: 'Deals', href: '/crm/deals', icon: 'handshake', anyOf: ['deals.view'], built: false },
      { label: 'Clients', href: '/crm/clients', icon: 'building', anyOf: ['clients.view'], built: false },
    ],
  },
  {
    label: 'Delivery',
    items: [
      {
        label: 'Projects',
        href: '/projects',
        icon: 'folder',
        anyOf: ['projects.view.all', 'projects.view.assigned'],
        built: false,
      },
      {
        label: 'Documents',
        href: '/documents',
        icon: 'file',
        anyOf: ['documents.view', 'documents.view.assigned'],
        built: false,
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Invoices', href: '/billing/invoices', icon: 'receipt', anyOf: ['invoices.view'], built: false },
      {
        label: 'Expenses',
        href: '/billing/expenses',
        icon: 'wallet',
        anyOf: ['expenses.log', 'expenses.approve'],
        built: false,
      },
      { label: 'Bills', href: '/billing/bills', icon: 'truck', anyOf: ['bills.manage', 'bills.pay'], built: false },
    ],
  },
  {
    label: 'Support',
    items: [
      {
        label: 'Tickets',
        href: '/support/tickets',
        icon: 'lifebuoy',
        anyOf: ['tickets.view.all', 'tickets.view.assigned'],
        built: false,
      },
      { label: 'Monitors', href: '/support/monitors', icon: 'activity', anyOf: ['monitors.manage'], built: false },
      { label: 'Vault', href: '/vault', icon: 'key', anyOf: ['vault.view.all', 'vault.view.assigned'], built: false },
    ],
  },
  {
    label: 'Studio',
    items: [
      { label: 'Team', href: '/team', icon: 'users', anyOf: ['team.view', 'timeoff.request'], built: true },
      { label: 'Website', href: '/cms', icon: 'globe', anyOf: ['cms.view'], built: false },
      {
        label: 'Reports',
        href: '/reports',
        icon: 'chart',
        anyOf: ['reports.finance.view', 'reports.delivery.view'],
        built: false,
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: 'settings',
        anyOf: ['settings.manage', 'settings.billing.sensitive', 'roles.manage', 'integrations.manage', 'audit.view'],
        built: true,
      },
    ],
  },
];

export const PORTAL_NAVIGATION: readonly NavSection[] = [
  {
    items: [
      { label: 'Home', href: '/', icon: 'home', built: true },
      { label: 'Projects', href: '/projects', icon: 'folder', anyOf: ['portal.projects.view'], built: false },
      { label: 'Documents', href: '/documents', icon: 'file', anyOf: ['portal.documents.view'], built: false },
      { label: 'Invoices', href: '/invoices', icon: 'receipt', anyOf: ['portal.invoices.view'], built: false },
      { label: 'Support', href: '/tickets', icon: 'lifebuoy', anyOf: ['portal.tickets.view'], built: false },
      { label: 'Reports', href: '/reports', icon: 'chart', anyOf: ['portal.reports.view'], built: false },
      { label: 'Colleagues', href: '/colleagues', icon: 'users', anyOf: ['portal.colleagues.manage'], built: false },
    ],
  },
];

/** The sections and items this role can see, with empty sections removed. */
export function navigationFor(surface: Surface, permissions: readonly string[]): NavSection[] {
  const held = new Set(permissions);
  const sections = surface === 'team' ? TEAM_NAVIGATION : PORTAL_NAVIGATION;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.anyOf || item.anyOf.some((key) => held.has(key))),
    }))
    .filter((section) => section.items.length > 0);
}

export function isActivePath(itemHref: string, pathname: string): boolean {
  return itemHref === '/' ? pathname === '/' : pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}
