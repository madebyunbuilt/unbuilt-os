import { addDays, toUtc } from '@/convex/lib/timeOffFormat';
import { type StatusTone } from '@/lib/team-display';

// How time off is shown: status labels in the brand's state colours, and the month grid for the leave calendar.

export type TimeOffStatus = 'requested' | 'approved' | 'declined' | 'cancelled';

export function timeOffStatus(status: TimeOffStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'requested':
      return { label: 'Pending', tone: 'draft' };
    case 'approved':
      return { label: 'Approved', tone: 'built' };
    case 'declined':
      return { label: 'Declined', tone: 'attention' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'muted' };
  }
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export type Month = { year: number; month: number };

export function monthOf(date: string): Month {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export function shiftMonth({ year, month }: Month, by: number): Month {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthLabel({ year, month }: Month): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** The first and last dates of a month. */
export function monthBounds(month: Month): { first: string; last: string } {
  return { first: shiftMonthStart(month, 0), last: addDays(shiftMonthStart(month, 1), -1) };
}

/** Weeks from the Monday on or before the 1st to the Sunday on or after the last day: four to six rows of seven dates. */
export function monthGrid({ year, month }: Month): string[][] {
  const { first, last } = monthBounds({ year, month });
  const weekday = (date: string) => (new Date(toUtc(date)).getUTCDay() + 6) % 7; // Monday = 0
  let day = addDays(first, -weekday(first));
  const end = addDays(last, 6 - weekday(last));
  const weeks: string[][] = [];
  while (day <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function shiftMonthStart(month: Month, by: number): string {
  const next = shiftMonth(month, by);
  return `${next.year}-${String(next.month).padStart(2, '0')}-01`;
}

/** 0 = Sunday … 6 = Saturday, matching business hours. */
export function weekdayOf(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}
