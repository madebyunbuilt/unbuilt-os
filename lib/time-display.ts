import { addDays, formatDateRange } from '@/convex/lib/timeOffFormat';
import { InputError } from '@/lib/convex-error';
import { type StatusTone } from '@/lib/team-display';

// How time is shown: an entry's state, the week it belongs to, and hours people type (06-projects.md, Time tracking).

export type TimeEntryStatus = 'draft' | 'submitted' | 'approved' | 'invoiced';

export function timeEntryStatus(status: TimeEntryStatus): { label: string; tone: StatusTone } {
  switch (status) {
    // A draft is still the member's to change; submitted is waiting on someone else.
    case 'draft':
      return { label: 'Draft', tone: 'draft' };
    case 'submitted':
      return { label: 'Waiting for approval', tone: 'attention' };
    case 'approved':
      return { label: 'Approved', tone: 'built' };
    case 'invoiced':
      return { label: 'Invoiced', tone: 'built' };
  }
}

/** The Monday of the week a YYYY-MM-DD date falls in, the same rule the server uses. */
export function weekStartOf(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - weekday * 86_400_000).toISOString().slice(0, 10);
}

/** The week as a range: "14–20 Sep 2026". */
export function weekLabel(weekStart: string): string {
  return formatDateRange(weekStart, addDays(weekStart, 6));
}

/** The seven dates of a week, Monday first. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, day) => addDays(weekStart, day));
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The weekday a date falls on, spelled out: Intl's short names differ between runtimes. */
export function weekdayName(date: string): string {
  return WEEKDAYS[(new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay() + 6) % 7];
}

/** Hours and minutes as people say them: 90 → "1h 30m", 120 → "2h", 45 → "45m", 0 → "0m". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Time typed as hours or as hours and minutes: "1.5" and "1:30" are both 90 minutes, "45m" is 45. Refuses anything
 * else, so a typo never becomes a silent zero.
 */
export function parseDurationToMinutes(value: string): number {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) throw new InputError('Say how long it took, such as 1.5 or 1:30');
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(trimmed);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const withUnits = /^(?:(\d{1,3}(?:[.,]\d+)?)\s*h)?\s*(?:(\d{1,3})\s*m)?$/.exec(trimmed);
  if (withUnits && (withUnits[1] !== undefined || withUnits[2] !== undefined)) {
    const hours = withUnits[1] === undefined ? 0 : Number(withUnits[1].replace(',', '.'));
    return Math.round(hours * 60) + Number(withUnits[2] ?? 0);
  }
  const hours = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(hours) || hours < 0) throw new InputError('Say how long it took, such as 1.5 or 1:30');
  return Math.round(hours * 60);
}
