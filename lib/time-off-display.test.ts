import { describe, expect, it } from 'vitest';
import { monthGrid, monthLabel, shiftMonth, timeOffStatus, weekdayOf } from './time-off-display';

describe('time off display', () => {
  it('labels statuses in the brand’s state colours', () => {
    expect(timeOffStatus('requested')).toEqual({ label: 'Pending', tone: 'draft' });
    expect(timeOffStatus('approved').tone).toBe('built');
    expect(timeOffStatus('declined').tone).toBe('attention');
    expect(timeOffStatus('cancelled').tone).toBe('muted');
  });

  it('lays a month out in Monday-first weeks', () => {
    const october = monthGrid({ year: 2026, month: 10 });
    // 1 October 2026 is a Thursday; 31 October a Saturday.
    expect(october[0]).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(october.at(-1)?.at(-1)).toBe('2026-11-01');
    expect(october).toHaveLength(5);
    // February 2027 starts on a Monday and ends on a Sunday.
    expect(monthGrid({ year: 2027, month: 2 })).toHaveLength(4);
    expect(weekdayOf('2026-10-01')).toBe(4);
  });

  it('moves between months across years', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthLabel({ year: 2026, month: 9 })).toBe('September 2026');
  });
});
