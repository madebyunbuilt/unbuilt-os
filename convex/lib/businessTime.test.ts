import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutes,
  type BusinessCalendar,
  businessMinutesBetween,
  BusinessTimeError,
  DEFAULT_BUSINESS_CALENDAR,
  type Holiday,
} from './businessTime';

const lagos = DEFAULT_BUSINESS_CALENDAR;
/** Wall-clock time in Lagos (UTC+1 all year) as a UTC instant. */
const lagosAt = (date: string, time: string) => Date.parse(`${date}T${time}:00+01:00`);
const add = (start: number, minutes: number, holidays: Holiday[] = [], calendar: BusinessCalendar = lagos) =>
  addBusinessMinutes(start, minutes, calendar, holidays);
const between = (a: number, b: number, holidays: Holiday[] = [], calendar: BusinessCalendar = lagos) =>
  businessMinutesBetween(a, b, calendar, holidays);

// 2026-09-11 is a Friday, 2026-12-25 is a Friday.
describe('addBusinessMinutes', () => {
  it('carries a ticket created at 16:55 on Friday into Monday', () => {
    expect(add(lagosAt('2026-09-11', '16:55'), 60)).toBe(lagosAt('2026-09-14', '09:55'));
  });

  it('skips a holiday on a Friday and the weekend after it', () => {
    const christmas = [{ date: '2026-12-25' }];
    expect(add(lagosAt('2026-12-24', '16:00'), 120, christmas)).toBe(lagosAt('2026-12-28', '10:00'));
  });

  it('skips the weekend and a holiday Monday (key flow: P2 raised 16:30 Friday)', () => {
    const holidayMonday = [{ date: '2026-09-14' }];
    const createdAt = lagosAt('2026-09-11', '16:30');
    expect(add(createdAt, 4 * 60, holidayMonday)).toBe(lagosAt('2026-09-15', '12:30'));
    expect(add(createdAt, 3 * 8 * 60, holidayMonday)).toBe(lagosAt('2026-09-17', '16:30'));
  });

  it('matches recurring holidays in any year', () => {
    const christmas = [{ date: '2000-12-25', recurring: true }];
    expect(add(lagosAt('2026-12-24', '16:00'), 120, christmas)).toBe(lagosAt('2026-12-28', '10:00'));
  });

  it('starts counting at opening time when created before hours', () => {
    expect(add(lagosAt('2026-09-14', '07:00'), 30)).toBe(lagosAt('2026-09-14', '09:30'));
  });

  it('starts counting the next business day when created after hours', () => {
    expect(add(lagosAt('2026-09-14', '18:00'), 30)).toBe(lagosAt('2026-09-15', '09:30'));
  });

  it('starts counting on Monday when created at the weekend', () => {
    expect(add(lagosAt('2026-09-12', '12:00'), 60)).toBe(lagosAt('2026-09-14', '10:00'));
  });

  it('lands exactly on closing time rather than rolling over', () => {
    expect(add(lagosAt('2026-09-14', '16:00'), 60)).toBe(lagosAt('2026-09-14', '17:00'));
  });

  it('returns the start for zero minutes', () => {
    const start = lagosAt('2026-09-12', '03:17');
    expect(add(start, 0)).toBe(start);
  });

  it('respects several windows in one day', () => {
    const withLunch: BusinessCalendar = {
      timezone: 'Africa/Lagos',
      weekly: [
        { day: 1, start: '13:00', end: '17:00' },
        { day: 1, start: '09:00', end: '12:00' },
      ],
    };
    expect(add(lagosAt('2026-09-14', '11:30'), 60, [], withLunch)).toBe(lagosAt('2026-09-14', '13:30'));
  });

  it('uses the calendar day in its timezone, not the UTC day', () => {
    // 23:30 UTC on Sunday is 00:30 on Monday in Lagos.
    expect(add(Date.parse('2026-09-13T23:30:00Z'), 60)).toBe(lagosAt('2026-09-14', '10:00'));
  });

  it('follows daylight-saving changes in zones that have them', () => {
    const london: BusinessCalendar = { ...lagos, timezone: 'Europe/London' };
    // Friday 27 March 2026 is GMT; clocks go forward on Sunday 29 March; Monday 30 March is BST.
    expect(add(Date.parse('2026-03-27T16:30:00Z'), 60, [], london)).toBe(Date.parse('2026-03-30T09:30:00+01:00'));
  });

  it.each([
    ['negative minutes', () => add(lagosAt('2026-09-14', '09:00'), -1)],
    ['fractional minutes', () => add(lagosAt('2026-09-14', '09:00'), 1.5)],
    ['an unknown timezone', () => add(0, 1, [], { ...lagos, timezone: 'Mars/Olympus' })],
    ['a malformed time', () => add(0, 1, [], { ...lagos, weekly: [{ day: 1, start: '9am', end: '17:00' }] })],
    [
      'hours that end before they start',
      () => add(0, 1, [], { ...lagos, weekly: [{ day: 1, start: '17:00', end: '09:00' }] }),
    ],
    [
      'overlapping hours',
      () =>
        add(0, 1, [], {
          ...lagos,
          weekly: [
            { day: 1, start: '09:00', end: '13:00' },
            { day: 1, start: '12:00', end: '17:00' },
          ],
        }),
    ],
    ['a calendar with no hours', () => add(0, 1, [], { ...lagos, weekly: [] })],
    ['a malformed holiday', () => add(0, 1, [{ date: '25/12/2026' }])],
  ])('rejects %s', (_, run) => {
    expect(run).toThrow(BusinessTimeError);
  });
});

describe('businessMinutesBetween', () => {
  it('counts only business time across a weekend', () => {
    expect(between(lagosAt('2026-09-11', '16:55'), lagosAt('2026-09-14', '09:55'))).toBe(60);
  });

  it('excludes holidays', () => {
    const holidayMonday = [{ date: '2026-09-14' }];
    expect(between(lagosAt('2026-09-11', '09:00'), lagosAt('2026-09-15', '17:00'), holidayMonday)).toBe(16 * 60);
  });

  it('is zero outside business hours and when the end is not after the start', () => {
    expect(between(lagosAt('2026-09-12', '09:00'), lagosAt('2026-09-13', '17:00'))).toBe(0);
    expect(between(lagosAt('2026-09-14', '12:00'), lagosAt('2026-09-14', '10:00'))).toBe(0);
  });

  it('counts a full working week', () => {
    expect(between(lagosAt('2026-09-14', '00:00'), lagosAt('2026-09-21', '00:00'))).toBe(5 * 8 * 60);
  });

  it('is the inverse of addBusinessMinutes', () => {
    const holidays = [{ date: '2026-10-01' }, { date: '2000-12-25', recurring: true }, { date: '2026-12-26' }];
    let seed = 20260913;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const yearStart = Date.parse('2026-01-01T00:00:00Z');

    for (let i = 0; i < 300; i++) {
      const start = yearStart + Math.floor(random() * 365 * 24 * 60) * 60_000;
      const minutes = Math.floor(random() * 10 * 8 * 60);
      expect(between(start, add(start, minutes, holidays), holidays)).toBe(minutes);
    }
  });
});
