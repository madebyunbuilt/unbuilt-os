import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  parseDurationToMinutes,
  timeEntryStatus,
  weekDays,
  weekLabel,
  weekdayName,
  weekStartOf,
} from './time-display';

describe('time display', () => {
  it('shows a submitted week as waiting on someone else', () => {
    expect(timeEntryStatus('draft')).toEqual({ label: 'Draft', tone: 'draft' });
    expect(timeEntryStatus('submitted')).toEqual({ label: 'Waiting for approval', tone: 'attention' });
    expect(timeEntryStatus('approved').tone).toBe('built');
    expect(timeEntryStatus('invoiced').label).toBe('Invoiced');
  });

  it('counts weeks from Monday, like the server', () => {
    // 2026-09-20 is a Sunday, so its week starts on Monday the 14th.
    expect(weekStartOf('2026-09-20')).toBe('2026-09-14');
    expect(weekStartOf('2026-09-14')).toBe('2026-09-14');
    expect(weekStartOf('2026-09-21')).toBe('2026-09-21');
    expect(weekDays('2026-09-14')).toHaveLength(7);
    expect(weekDays('2026-09-14').at(-1)).toBe('2026-09-20');
    expect(weekdayName('2026-09-14')).toBe('Monday');
    expect(weekdayName('2026-09-20')).toBe('Sunday');
    expect(weekLabel('2026-09-14')).toBe('14–20 Sep 2026');
  });

  it('reads time however it is typed and says it back plainly', () => {
    expect(parseDurationToMinutes('1.5')).toBe(90);
    expect(parseDurationToMinutes('1,5')).toBe(90);
    expect(parseDurationToMinutes('1:30')).toBe(90);
    expect(parseDurationToMinutes('1h 30m')).toBe(90);
    expect(parseDurationToMinutes('45m')).toBe(45);
    expect(parseDurationToMinutes('2h')).toBe(120);
    expect(() => parseDurationToMinutes('')).toThrow(/how long/);
    expect(() => parseDurationToMinutes('a while')).toThrow(/how long/);
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(0)).toBe('0m');
  });
});
