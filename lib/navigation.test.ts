import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, isPortalPermission, isTeamPermission } from '@/convex/lib/permissions';
import { isActivePath, navigationFor, PORTAL_NAVIGATION, TEAM_NAVIGATION } from './navigation';

const permissionsOf = (key: string) => [...(DEFAULT_ROLES.find((role) => role.key === key)?.permissions ?? [])];
const labels = (sections: ReturnType<typeof navigationFor>) => sections.flatMap((s) => s.items.map((i) => i.label));

describe('navigation', () => {
  it('only references real permission keys for its surface', () => {
    for (const item of TEAM_NAVIGATION.flatMap((s) => s.items)) {
      for (const key of item.anyOf ?? []) expect(isTeamPermission(key), key).toBe(true);
    }
    for (const item of PORTAL_NAVIGATION.flatMap((s) => s.items)) {
      for (const key of item.anyOf ?? []) expect(isPortalPermission(key), key).toBe(true);
    }
  });

  it('shows the Owner every team item', () => {
    expect(labels(navigationFor('team', permissionsOf('owner')))).toEqual(
      TEAM_NAVIGATION.flatMap((s) => s.items.map((i) => i.label)),
    );
  });

  it('shows a Content editor only home, team and the website', () => {
    expect(labels(navigationFor('team', permissionsOf('content_editor')))).toEqual(['Home', 'Team', 'Website']);
  });

  it('shows project managers Settings, where business hours and holidays are read-only for them', () => {
    expect(labels(navigationFor('team', permissionsOf('project_manager')))).toContain('Settings');
  });

  it('hides finance from Members and drops empty sections', () => {
    const sections = navigationFor('team', permissionsOf('member'));
    expect(labels(sections)).toEqual(['Home', 'Projects', 'Time', 'Documents', 'Expenses', 'Tickets', 'Vault', 'Team']);
    expect(sections.map((s) => s.label)).not.toContain('CRM');
  });

  it('keeps invoices and colleagues from client members', () => {
    expect(labels(navigationFor('portal', permissionsOf('client_member')))).toEqual([
      'Home',
      'Projects',
      'Documents',
      'Support',
      'Credentials',
    ]);
    expect(labels(navigationFor('portal', permissionsOf('client_admin')))).toContain('Invoices');
  });

  it('shows only home to someone with no permissions', () => {
    expect(labels(navigationFor('team', []))).toEqual(['Home']);
  });

  it('matches the current page by path segment', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/', '/projects')).toBe(false);
    expect(isActivePath('/projects', '/projects/abc')).toBe(true);
    expect(isActivePath('/projects', '/projectsx')).toBe(false);
  });
});
