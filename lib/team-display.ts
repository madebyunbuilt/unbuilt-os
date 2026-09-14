// How team members are shown: status labels in the brand's state colours, initials and capacity.

export type StatusTone = 'draft' | 'attention' | 'built' | 'muted';

export function memberStatus(member: {
  status: 'invited' | 'active' | 'suspended' | 'offboarded';
  invite: 'pending' | 'expired' | null;
}): { label: string; tone: StatusTone } {
  switch (member.status) {
    case 'invited':
      // Blue means not built yet: an invite nobody accepted. An expired one needs someone's attention.
      return member.invite === 'expired'
        ? { label: 'Invite expired', tone: 'attention' }
        : { label: 'Invited', tone: 'draft' };
    case 'active':
      return { label: 'Active', tone: 'built' };
    case 'suspended':
      return { label: 'Suspended', tone: 'attention' };
    case 'offboarded':
      return { label: 'Offboarded', tone: 'muted' };
  }
}

export function initials(name: string): string {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Minutes per week as hours, for display and editing: 2400 → "40". */
export function minutesToHours(minutes: number | undefined): string {
  if (minutes === undefined) return '';
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** Hours typed by a person, to whole minutes. Empty means not set. */
export function hoursToMinutes(hours: string): number | undefined {
  const trimmed = hours.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 60);
}
