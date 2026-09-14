import { describe, expect, it } from 'vitest';
import { DEFAULT_BUSINESS_CALENDAR } from './businessTime';
import { addDays, datesBetween, formatDateRange, validateDates, workingDays } from './timeOff';

const weekly = DEFAULT_BUSINESS_CALENDAR.weekly;

describe('time off dates', () => {
  it('counts working days, skipping weekends and public holidays', () => {
    // Thu 1 Oct 2026 (Independence Day) to Wed 7 Oct: Fri, Mon, Tue, Wed.
    const range = { startDate: '2026-10-01', endDate: '2026-10-07', halfDay: false };
    expect(workingDays(range, weekly, [{ date: '2026-10-01' }])).toBe(4);
    expect(workingDays(range, weekly, [])).toBe(5);
    expect(workingDays(range, weekly, [{ date: '2020-10-01', recurring: true }])).toBe(4);
    expect(workingDays({ startDate: '2026-10-05', endDate: '2026-10-05', halfDay: true }, weekly, [])).toBe(0.5);
    expect(workingDays({ startDate: '2026-10-03', endDate: '2026-10-04', halfDay: false }, weekly, [])).toBe(0);
  });

  it('refuses reversed, overlong and multi-day half-day ranges', () => {
    expect(() => validateDates({ startDate: '2026-10-05', endDate: '2026-10-02', halfDay: false })).toThrow(
      /on or after/,
    );
    expect(() => validateDates({ startDate: '2026-02-30', endDate: '2026-03-01', halfDay: false })).toThrow(/Choose/);
    expect(() => validateDates({ startDate: '2026-01-01', endDate: '2027-01-02', halfDay: false })).toThrow(/366/);
    expect(() => validateDates({ startDate: '2026-10-05', endDate: '2026-10-06', halfDay: true })).toThrow(/half day/);
  });

  it('walks dates across months and years', () => {
    expect(datesBetween('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('formats ranges for notifications', () => {
    expect(formatDateRange('2026-10-05', '2026-10-05')).toBe('5 Oct 2026');
    expect(formatDateRange('2026-10-05', '2026-10-07')).toBe('5–7 Oct 2026');
    expect(formatDateRange('2026-09-30', '2026-10-02')).toBe('30 Sep – 2 Oct 2026');
    expect(formatDateRange('2026-12-31', '2027-01-02')).toBe('31 Dec 2026 – 2 Jan 2027');
  });
});
