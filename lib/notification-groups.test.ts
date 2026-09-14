import { describe, expect, it } from 'vitest';
import { groupByDay } from './notification-groups';

describe('groupByDay', () => {
  // 10:00 on Monday 14 September 2026 in Lagos.
  const now = Date.parse('2026-09-14T10:00:00+01:00');
  const at = (iso: string) => ({ createdAt: Date.parse(iso) });

  it('labels today, yesterday and older days in order', () => {
    const items = [
      at('2026-09-14T09:00:00+01:00'),
      at('2026-09-14T00:30:00+01:00'),
      at('2026-09-13T23:30:00+01:00'),
      at('2026-09-10T12:00:00+01:00'),
    ];
    const groups = groupByDay(items, { now, timeZone: 'Africa/Lagos' });
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['Thu 10 Sept', 1],
    ]);
  });

  it('uses the viewer’s timezone for the day boundary', () => {
    // 00:30 Lagos on the 14th is still the 13th in New York.
    const item = at('2026-09-14T00:30:00+01:00');
    expect(groupByDay([item], { now, timeZone: 'Africa/Lagos' })[0].label).toBe('Today');
    expect(groupByDay([item], { now, timeZone: 'America/New_York' })[0].label).toBe('Yesterday');
  });
});
