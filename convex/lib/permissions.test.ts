import { describe, expect, it } from 'vitest';
import {
  assertValidRolePermissions,
  DEFAULT_ROLES,
  isPortalPermission,
  isTeamPermission,
  type Permission,
  PORTAL_PERMISSIONS,
  TEAM_PERMISSIONS,
} from './permissions';

const role = (key: (typeof DEFAULT_ROLES)[number]['key']) => {
  const found = DEFAULT_ROLES.find((r) => r.key === key)!;
  return new Set<Permission>(found.permissions);
};

describe('permission keys', () => {
  it('are unique and follow resource.action(.scope)', () => {
    const all = [...TEAM_PERMISSIONS, ...PORTAL_PERMISSIONS];
    expect(new Set(all).size).toBe(all.length);
    for (const key of all) expect(key).toMatch(/^[a-z]+(\.[a-z]+){1,2}$/);
  });

  it('keep portal keys and team keys apart', () => {
    expect(TEAM_PERMISSIONS.every((key) => !key.startsWith('portal.'))).toBe(true);
    expect(PORTAL_PERMISSIONS.every((key) => key.startsWith('portal.'))).toBe(true);
    expect(isTeamPermission('portal.invoices.pay')).toBe(false);
    expect(isPortalPermission('invoices.view')).toBe(false);
  });
});

describe('assertValidRolePermissions', () => {
  it('rejects a team role holding a portal key', () => {
    expect(() => assertValidRolePermissions('team', ['clients.view', 'portal.invoices.pay'])).toThrow(
      /portal.invoices.pay/,
    );
  });

  it('rejects a client role holding a team key', () => {
    expect(() => assertValidRolePermissions('client', ['portal.tickets.view', 'invoices.view'])).toThrow(
      /invoices.view/,
    );
  });

  it('rejects unknown and duplicated keys', () => {
    expect(() => assertValidRolePermissions('team', ['clients.veiw'])).toThrow();
    expect(() => assertValidRolePermissions('team', ['clients.view', 'clients.view'])).toThrow();
  });

  it('accepts every default role', () => {
    for (const defaultRole of DEFAULT_ROLES) {
      expect(() => assertValidRolePermissions(defaultRole.kind, defaultRole.permissions)).not.toThrow();
    }
  });
});

describe('default roles', () => {
  it('give the Owner everything and the Admin everything but ownership transfer', () => {
    expect(role('owner')).toEqual(new Set(TEAM_PERMISSIONS));
    expect(role('admin')).toEqual(new Set(TEAM_PERMISSIONS.filter((key) => key !== 'owner.transfer')));
  });

  it('match the role table for Finance', () => {
    const finance = role('finance');
    for (const key of [
      'invoices.void',
      'payments.refund',
      'bills.pay',
      'team.rates.sensitive',
      'settings.billing.sensitive',
    ] as const) {
      expect(finance.has(key), key).toBe(true);
    }
    for (const key of [
      'clients.update',
      'documents.countersign',
      'vault.view.assigned',
      'cms.view',
      'audit.view',
    ] as const) {
      expect(finance.has(key), key).toBe(false);
    }
  });

  it('match the role table for Project managers', () => {
    const pm = role('project_manager');
    expect(pm.has('clients.update')).toBe(true);
    expect(pm.has('clients.delete')).toBe(false); // all except delete
    expect(pm.has('invoices.create')).toBe(true);
    expect(pm.has('invoices.send')).toBe(false); // drafts only
    expect(pm.has('team.rates.sensitive')).toBe(false);
    expect(pm.has('documents.countersign')).toBe(false);
  });

  it('limit Members to assigned work', () => {
    const member = role('member');
    expect(member.has('projects.view.assigned')).toBe(true);
    expect(member.has('documents.view.assigned')).toBe(true);
    expect([...member].some((key) => key.endsWith('.all'))).toBe(false);
    expect(member.has('documents.view')).toBe(false);
  });

  it('limit Content editors to the CMS and time off', () => {
    expect(role('content_editor')).toEqual(new Set(['cms.view', 'cms.edit', 'cms.publish', 'timeoff.request']));
  });

  it('include the fills approved on 2026-09-13', () => {
    for (const key of ['owner', 'admin', 'finance', 'project_manager', 'member', 'content_editor'] as const) {
      expect(role(key).has('timeoff.request'), key).toBe(true);
    }
    for (const key of ['fx.manage', 'schedules.manage', 'retainers.manage', 'team.view', 'capacity.view'] as const) {
      expect(role('finance').has(key), key).toBe(true);
    }
    for (const key of [
      'invoices.view',
      'handover.manage',
      'templates.documents.manage',
      'reports.delivery.view',
      'calendar.use',
      'time.log.own',
      'clients.export',
    ] as const) {
      expect(role('project_manager').has(key), key).toBe(true);
    }
    expect(role('content_editor').has('cms.settings.manage')).toBe(false);
  });

  it('give client admins every portal key and client members the table’s subset', () => {
    expect(role('client_admin')).toEqual(new Set(PORTAL_PERMISSIONS));
    const clientMember = role('client_member');
    for (const key of [
      'portal.changerequests.approve',
      'portal.invoices.view',
      'portal.invoices.pay',
      'portal.reports.view',
      'portal.colleagues.manage',
    ] as const) {
      expect(clientMember.has(key), key).toBe(false);
    }
    expect(clientMember.has('portal.deliverables.approve')).toBe(true);
  });
});
