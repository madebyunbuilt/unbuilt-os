import { describe, expect, it } from 'vitest';
import { hoursToMinutes, initials, memberStatus, minutesToHours } from './team-display';

describe('team display', () => {
  it('labels statuses in the brand’s state colours', () => {
    expect(memberStatus({ status: 'invited', invite: 'pending' })).toEqual({ label: 'Invited', tone: 'draft' });
    expect(memberStatus({ status: 'invited', invite: 'expired' })).toEqual({
      label: 'Invite expired',
      tone: 'attention',
    });
    expect(memberStatus({ status: 'active', invite: null })).toEqual({ label: 'Active', tone: 'built' });
    expect(memberStatus({ status: 'suspended', invite: null }).tone).toBe('attention');
    expect(memberStatus({ status: 'offboarded', invite: null }).tone).toBe('muted');
  });

  it('builds initials from names and emails', () => {
    expect(initials('Dayo Ade')).toBe('DA');
    expect(initials('kemi@unbuilt.studio')).toBe('KU');
    expect(initials('')).toBe('?');
  });

  it('converts weekly capacity between hours and minutes', () => {
    expect(minutesToHours(2400)).toBe('40');
    expect(minutesToHours(90)).toBe('1.5');
    expect(minutesToHours(undefined)).toBe('');
    expect(hoursToMinutes('37.5')).toBe(2250);
    expect(hoursToMinutes('')).toBeUndefined();
    expect(hoursToMinutes('forty')).toBeNaN();
  });
});
