import { ConvexError } from 'convex/values';

// Permission keys and default roles: docs/spec/03-auth-and-permissions.md. Roles store arrays of these keys.

export const TEAM_PERMISSIONS = [
  // CRM
  'enquiries.view',
  'enquiries.manage',
  'deals.view',
  'deals.manage',
  'clients.view',
  'clients.create',
  'clients.update',
  'clients.delete',
  'clients.export',
  'contacts.manage',
  'ratecard.view',
  'ratecard.manage',
  'calendar.use',
  'intake.manage',
  // Projects
  'projects.view.all',
  'projects.view.assigned',
  'projects.create',
  'projects.update',
  'projects.archive',
  'projects.members.manage',
  'templates.projects.manage',
  'tasks.manage.assigned',
  'tasks.manage.all',
  'deliverables.manage.assigned',
  'changerequests.create',
  'changerequests.send',
  'updates.send',
  'handover.manage',
  // Time
  'time.log.own',
  'time.view.all',
  'time.approve',
  'time.edit.all',
  // Documents
  'documents.view',
  'documents.view.assigned',
  'documents.create',
  'documents.update',
  'documents.send',
  'documents.void',
  'documents.countersign',
  'templates.documents.manage',
  // Billing and finance
  'invoices.view',
  'invoices.create',
  'invoices.update',
  'invoices.send',
  'invoices.void',
  'invoices.writeoff',
  'invoices.latefees.waive',
  'payments.record',
  'payments.refund',
  'creditnotes.create',
  'schedules.manage',
  'retainers.manage',
  'fx.manage',
  'expenses.log',
  'expenses.approve',
  'vendors.manage',
  'bills.manage',
  'bills.pay',
  'finance.export',
  'reports.finance.view',
  // Support
  'tickets.view.assigned',
  'tickets.view.all',
  'tickets.manage',
  'sla.manage',
  'monitors.manage',
  'assets.manage',
  // Vault
  'vault.view.assigned',
  'vault.view.all',
  'vault.manage',
  // Team
  'team.view',
  'team.manage',
  'team.rates.sensitive',
  'timeoff.request',
  'timeoff.approve',
  'capacity.view',
  'reports.delivery.view',
  // CMS
  'cms.view',
  'cms.edit',
  'cms.publish',
  'cms.settings.manage',
  // Platform
  'settings.manage',
  'settings.billing.sensitive',
  'roles.manage',
  'audit.view',
  'imports.run',
  'privacy.requests.manage',
  'integrations.manage',
  'owner.transfer',
] as const;

export const PORTAL_PERMISSIONS = [
  'portal.projects.view',
  'portal.deliverables.approve',
  'portal.changerequests.approve',
  'portal.documents.view',
  'portal.documents.sign',
  'portal.invoices.view',
  'portal.invoices.pay',
  'portal.tickets.create',
  'portal.tickets.view',
  'portal.vault.submit',
  'portal.intake.submit',
  'portal.reports.view',
  'portal.colleagues.manage',
  'portal.files.upload',
] as const;

export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];
export type PortalPermission = (typeof PORTAL_PERMISSIONS)[number];
export type Permission = TeamPermission | PortalPermission;
export type RoleKind = 'team' | 'client';

const teamPermissionSet: ReadonlySet<string> = new Set(TEAM_PERMISSIONS);
const portalPermissionSet: ReadonlySet<string> = new Set(PORTAL_PERMISSIONS);

export function isTeamPermission(key: string): key is TeamPermission {
  return teamPermissionSet.has(key);
}

export function isPortalPermission(key: string): key is PortalPermission {
  return portalPermissionSet.has(key);
}

/**
 * A team role holds only team keys and a client role only portal keys. Unknown and duplicate keys are rejected too,
 * so a typo can never silently grant or drop access.
 */
export function assertValidRolePermissions(kind: RoleKind, permissions: readonly string[]): void {
  const allowed = kind === 'team' ? isTeamPermission : isPortalPermission;
  const invalid = permissions.filter((key) => !allowed(key));
  if (invalid.length > 0) {
    throw new ConvexError({
      code: 'roles.invalidPermissions',
      message: `A ${kind} role cannot hold: ${invalid.join(', ')}`,
    });
  }
  if (new Set(permissions).size !== permissions.length) {
    throw new ConvexError({ code: 'roles.invalidPermissions', message: 'A role cannot list a permission twice' });
  }
}

export type DefaultRole = {
  key: string;
  name: string;
  kind: RoleKind;
  description: string;
  permissions: readonly Permission[];
};

const without = (keys: readonly TeamPermission[], excluded: readonly TeamPermission[]) =>
  keys.filter((key) => !excluded.includes(key));

// The role table in 03-auth-and-permissions.md, plus the fills the studio approved on 2026-09-13 (marked "approved").
export const DEFAULT_ROLES = [
  {
    key: 'owner',
    name: 'Owner',
    kind: 'team',
    description: 'Everything, including transferring ownership.',
    permissions: TEAM_PERMISSIONS,
  },
  {
    key: 'admin',
    name: 'Admin',
    kind: 'team',
    description: 'Everything except transferring ownership.',
    permissions: without(TEAM_PERMISSIONS, ['owner.transfer']),
  },
  {
    key: 'finance',
    name: 'Finance',
    kind: 'team',
    description: 'Invoices, payments, bills, expenses and finance reports; read-only elsewhere.',
    permissions: [
      'enquiries.view',
      'deals.view',
      'clients.view',
      'ratecard.view',
      'projects.view.all',
      'time.view.all',
      'documents.view',
      'invoices.view',
      'invoices.create',
      'invoices.update',
      'invoices.send',
      'invoices.void',
      'invoices.writeoff',
      'invoices.latefees.waive',
      'payments.record',
      'payments.refund',
      'creditnotes.create',
      'schedules.manage', // approved
      'retainers.manage', // approved
      'fx.manage', // approved
      'expenses.approve',
      'vendors.manage',
      'bills.manage',
      'bills.pay',
      'finance.export',
      'reports.finance.view',
      'tickets.view.all',
      'team.view',
      'capacity.view', // approved
      'team.rates.sensitive',
      'timeoff.request', // approved
      'settings.billing.sensitive',
    ],
  },
  {
    key: 'project_manager',
    name: 'Project manager',
    kind: 'team',
    description: 'Clients, deals, projects, documents, change requests and support.',
    permissions: [
      'enquiries.view',
      'enquiries.manage',
      'deals.view',
      'deals.manage',
      'clients.view',
      'clients.create',
      'clients.update',
      'clients.export', // approved
      'contacts.manage',
      'ratecard.view',
      'ratecard.manage',
      'intake.manage',
      'calendar.use', // approved
      'projects.view.all',
      'projects.create',
      'projects.update',
      'projects.archive',
      'projects.members.manage',
      'templates.projects.manage',
      'tasks.manage.all',
      'deliverables.manage.assigned',
      'changerequests.create',
      'changerequests.send',
      'updates.send',
      'handover.manage', // approved
      'time.log.own', // approved
      'time.view.all',
      'time.approve',
      'documents.view',
      'documents.create',
      'documents.update',
      'documents.send',
      'templates.documents.manage', // approved
      'invoices.view', // approved
      'invoices.create',
      'expenses.log',
      'tickets.view.all',
      'tickets.manage',
      'sla.manage',
      'monitors.manage',
      'assets.manage',
      'vault.view.assigned',
      'vault.manage',
      'team.view',
      'capacity.view',
      'timeoff.request', // approved
      'reports.delivery.view', // approved
      'cms.view',
    ],
  },
  {
    key: 'member',
    name: 'Member',
    kind: 'team',
    description: 'Assigned projects: tasks, time, deliverables, documents, tickets and vault items.',
    permissions: [
      'projects.view.assigned',
      'tasks.manage.assigned',
      'deliverables.manage.assigned',
      'time.log.own',
      'documents.view.assigned', // approved: new scoped key
      'expenses.log',
      'tickets.view.assigned',
      'vault.view.assigned',
      'timeoff.request',
    ],
  },
  {
    key: 'content_editor',
    name: 'Content editor',
    kind: 'team',
    description: 'The website CMS only.',
    permissions: ['cms.view', 'cms.edit', 'cms.publish', 'timeoff.request'],
  },
  {
    key: 'client_admin',
    name: 'Client admin',
    kind: 'client',
    description: 'Everything in the portal for their company, including colleagues, invoices and SLA reports.',
    permissions: PORTAL_PERMISSIONS,
  },
  {
    key: 'client_member',
    name: 'Client member',
    kind: 'client',
    description: "View their company's projects and documents, approve deliverables, raise tickets.",
    permissions: [
      'portal.projects.view',
      'portal.deliverables.approve',
      'portal.documents.view',
      'portal.documents.sign', // record rule: only when named as a signer
      'portal.tickets.create',
      'portal.tickets.view',
      'portal.vault.submit',
      'portal.intake.submit',
      'portal.files.upload',
    ],
  },
] as const satisfies readonly DefaultRole[];

export type SystemRoleKey = (typeof DEFAULT_ROLES)[number]['key'];
export const OWNER_ROLE_KEY = 'owner' satisfies SystemRoleKey;
