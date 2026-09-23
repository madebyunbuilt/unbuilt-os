import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, isTeamPermission } from '@/convex/lib/permissions';
import { SETTINGS_SECTIONS, settingsSectionsFor } from './settings-sections';

const permissionsOf = (key: string) => [...(DEFAULT_ROLES.find((role) => role.key === key)?.permissions ?? [])];
const labels = (key: string) => settingsSectionsFor(permissionsOf(key)).map((section) => section.label);

describe('settings sections', () => {
  it('only use real team permission keys', () => {
    for (const section of SETTINGS_SECTIONS) {
      for (const key of section.anyOf) expect(isTeamPermission(key), key).toBe(true);
    }
  });

  it('show Admins every section', () => {
    expect(labels('admin')).toEqual(SETTINGS_SECTIONS.map((section) => section.label));
  });

  it('show Finance billing and exchange rates', () => {
    expect(labels('finance')).toEqual(['Billing', 'Exchange rates']);
  });

  it('show Project managers the SLA sections and document templates, and no organisation or billing', () => {
    expect(labels('project_manager')).toEqual([
      'Pipeline',
      'Document templates',
      'Clauses',
      'Business hours and holidays',
      'SLA policies',
    ]);
  });

  it('show Members nothing', () => {
    expect(labels('member')).toEqual([]);
  });
});
