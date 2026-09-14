// Time off dates and labels, with no server imports so screens can share them. Dates are YYYY-MM-DD.

export const TIME_OFF_TYPES = ['annual', 'sick', 'public', 'unpaid', 'other'] as const;
export type TimeOffType = (typeof TIME_OFF_TYPES)[number];

export const TYPE_LABELS: Record<TimeOffType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  public: 'Public holiday',
  unpaid: 'Unpaid leave',
  other: 'Other leave',
};

export const DAY_MS = 86_400_000;
export const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Every date from `start` to `end` inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let ms = toUtc(start); ms <= toUtc(end); ms += DAY_MS) dates.push(fromUtc(ms));
  return dates;
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

// Spelled out rather than Intl, whose abbreviations ("Sep" or "Sept") differ between runtimes.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (date: string) => Number(date.slice(8, 10));
const dayMonth = (date: string) => `${dayOf(date)} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const fullDate = (date: string) => `${dayMonth(date)} ${date.slice(0, 4)}`;

/** "3 Oct 2026", "3–5 Oct 2026" or "30 Sep – 2 Oct 2026", for notifications. */
export function formatDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return fullDate(startDate);
  if (startDate.slice(0, 7) === endDate.slice(0, 7)) return `${dayOf(startDate)}–${fullDate(endDate)}`;
  if (startDate.slice(0, 4) === endDate.slice(0, 4)) return `${dayMonth(startDate)} – ${fullDate(endDate)}`;
  return `${fullDate(startDate)} – ${fullDate(endDate)}`;
}

export function formatDays(days: number): string {
  return `${days} working ${days === 1 ? 'day' : 'days'}`;
}
