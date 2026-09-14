import { ConvexError } from 'convex/values';

// Business-hours arithmetic for SLA timers and business rules (09-support-and-sla.md, Business hours and holidays).
// Instants are UTC epoch milliseconds. Weekly hours and holidays are read as wall-clock time in the calendar's timezone.

export type WeeklyHours = {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  /** "HH:MM", 24-hour */
  start: string;
  /** "HH:MM", 24-hour, after start; "24:00" means midnight at the end of the day */
  end: string;
};

export type BusinessCalendar = { timezone: string; weekly: WeeklyHours[] };

/** `date` is YYYY-MM-DD in the calendar's timezone. A recurring holiday matches its month and day every year. */
export type Holiday = { date: string; recurring?: boolean };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** addBusinessMinutes gives up after this many days without enough business time. */
const MAX_SEARCH_DAYS = 3 * 366;

export class BusinessTimeError extends ConvexError<{ code: 'businessTime.invalid'; message: string }> {
  constructor(message: string) {
    super({ code: 'businessTime.invalid', message });
  }
}

type LocalDate = { year: number; month: number; day: number };
type Window = { startMs: number; endMs: number };
type PreparedCalendar = {
  timezone: string;
  minutesByWeekday: { start: number; end: number }[][];
  holidayDates: Set<string>;
  recurringHolidays: Set<string>;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    } catch {
      throw new BusinessTimeError(`Unknown timezone "${timeZone}"`);
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Milliseconds to add to a UTC instant to get wall-clock time in `timeZone`. */
function offsetMs(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(instant)) parts[type] = Number(value);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

function localDateOf(instant: number, timeZone: string): LocalDate {
  const shifted = new Date(instant + offsetMs(instant, timeZone));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function addDays({ year, month, day }: LocalDate, days: number): LocalDate {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The UTC instant of a wall-clock time. Two passes settle the offset across daylight-saving changes. */
function localToUtc({ year, month, day }: LocalDate, minuteOfDay: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstGuess = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(firstGuess, timeZone);
}

const pad = (n: number) => String(n).padStart(2, '0');

function parseClock(value: string, allowEndOfDay: boolean): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  const valid = match && minutes < 60 && (hours < 24 || (allowEndOfDay && hours === 24 && minutes === 0));
  if (!valid) throw new BusinessTimeError(`Invalid time "${value}", expected HH:MM`);
  return hours * 60 + minutes;
}

function prepare(calendar: BusinessCalendar, holidays: Holiday[]): PreparedCalendar {
  formatterFor(calendar.timezone);

  const minutesByWeekday: PreparedCalendar['minutesByWeekday'] = Array.from({ length: 7 }, () => []);
  for (const hours of calendar.weekly) {
    if (!Number.isInteger(hours.day) || hours.day < 0 || hours.day > 6) {
      throw new BusinessTimeError(`Invalid weekday ${hours.day}`);
    }
    const start = parseClock(hours.start, false);
    const end = parseClock(hours.end, true);
    if (end <= start) {
      throw new BusinessTimeError(`Business hours must end after they start (${hours.start}–${hours.end})`);
    }
    minutesByWeekday[hours.day].push({ start, end });
  }
  for (const windows of minutesByWeekday) {
    windows.sort((a, b) => a.start - b.start);
    for (let i = 1; i < windows.length; i++) {
      if (windows[i].start < windows[i - 1].end) throw new BusinessTimeError('Business hours overlap on the same day');
    }
  }
  if (minutesByWeekday.every((windows) => windows.length === 0)) {
    throw new BusinessTimeError('The calendar has no business hours');
  }

  const holidayDates = new Set<string>();
  const recurringHolidays = new Set<string>();
  for (const holiday of holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday.date)) {
      throw new BusinessTimeError(`Invalid holiday date "${holiday.date}"`);
    }
    if (holiday.recurring) {
      recurringHolidays.add(holiday.date.slice(5));
    } else {
      holidayDates.add(holiday.date);
    }
  }

  return { timezone: calendar.timezone, minutesByWeekday, holidayDates, recurringHolidays };
}

/** Business windows in chronological order, from the local day containing `fromMs`, for `days` days. */
function* windows(calendar: PreparedCalendar, fromMs: number, days: number): Generator<Window> {
  const firstDay = localDateOf(fromMs, calendar.timezone);
  for (let i = 0; i < days; i++) {
    const date = addDays(firstDay, i);
    const monthDay = `${pad(date.month)}-${pad(date.day)}`;
    if (calendar.holidayDates.has(`${date.year}-${monthDay}`) || calendar.recurringHolidays.has(monthDay)) continue;

    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    for (const { start, end } of calendar.minutesByWeekday[weekday]) {
      yield { startMs: localToUtc(date, start, calendar.timezone), endMs: localToUtc(date, end, calendar.timezone) };
    }
  }
}

function assertInstant(value: number, name: string) {
  if (!Number.isSafeInteger(value)) throw new BusinessTimeError(`${name} must be epoch milliseconds`);
}

/** The instant `minutes` business minutes after `startAt`. Time outside business hours and on holidays is skipped. */
export function addBusinessMinutes(
  startAt: number,
  minutes: number,
  calendar: BusinessCalendar,
  holidays: Holiday[],
): number {
  assertInstant(startAt, 'startAt');
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new BusinessTimeError(`minutes must be a non-negative whole number, got ${minutes}`);
  }
  const prepared = prepare(calendar, holidays);
  if (minutes === 0) return startAt;

  let remainingMs = minutes * MINUTE_MS;
  for (const { startMs, endMs } of windows(prepared, startAt, MAX_SEARCH_DAYS)) {
    if (endMs <= startAt) continue;
    const fromMs = Math.max(startMs, startAt);
    const availableMs = endMs - fromMs;
    if (remainingMs <= availableMs) return fromMs + remainingMs;
    remainingMs -= availableMs;
  }
  throw new BusinessTimeError(`Not enough business time within ${MAX_SEARCH_DAYS} days`);
}

/** Whole business minutes between two instants; 0 when `endAt` is not after `startAt`. */
export function businessMinutesBetween(
  startAt: number,
  endAt: number,
  calendar: BusinessCalendar,
  holidays: Holiday[],
): number {
  assertInstant(startAt, 'startAt');
  assertInstant(endAt, 'endAt');
  const prepared = prepare(calendar, holidays);
  if (endAt <= startAt) return 0;

  // Two extra days cover the local day at each end regardless of the timezone offset.
  const days = Math.ceil((endAt - startAt) / DAY_MS) + 2;
  let totalMs = 0;
  for (const { startMs, endMs } of windows(prepared, startAt, days)) {
    if (startMs >= endAt) break;
    const overlapMs = Math.min(endMs, endAt) - Math.max(startMs, startAt);
    if (overlapMs > 0) totalMs += overlapMs;
  }
  return Math.floor(totalMs / MINUTE_MS);
}

/** Throws BusinessTimeError when the calendar or holidays are unusable: bad timezone, times, overlaps or no hours. */
export function assertValidCalendar(calendar: BusinessCalendar, holidays: Holiday[] = []): void {
  prepare(calendar, holidays);
}

/** The calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDateString(instant: number, timeZone: string): string {
  assertInstant(instant, 'instant');
  const { year, month, day } = localDateOf(instant, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Monday to Friday, 09:00 to 17:00, Africa/Lagos: the default calendar from 09-support-and-sla.md. */
export const DEFAULT_BUSINESS_CALENDAR: BusinessCalendar = {
  timezone: 'Africa/Lagos',
  weekly: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
};
