import { describe, expect, it } from 'vitest';
import { billingDay, firstPeriod, periodFrom, splitUsage, usageBps } from './retainers';

// The retainer period maths (08-billing-and-finance.md, Retainers). What matters here: periods meet without a gap or an
// overlap whatever the invoice day, and rollover is spent before the period's own minutes so that carried minutes are
// worth having while still expiring after one period.

describe('when a period runs', () => {
  it('ends the day before the next invoice day', () => {
    expect(periodFrom('2026-10-01', 1)).toEqual({ periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    expect(periodFrom('2026-10-15', 15)).toEqual({ periodStart: '2026-10-15', periodEnd: '2026-11-14' });
  });

  it('falls on the last day of a month too short for the invoice day', () => {
    expect(billingDay(2027, 1, 31)).toBe('2027-02-28');
    // A leap February still takes the 29th.
    expect(billingDay(2028, 1, 31)).toBe('2028-02-29');
    expect(periodFrom('2027-01-31', 31)).toEqual({ periodStart: '2027-01-31', periodEnd: '2027-02-27' });
  });

  it('runs one period into the next without a gap or an overlap', () => {
    let start = '2026-10-31';
    for (const expected of ['2026-11-29', '2026-12-30', '2027-01-30', '2027-02-27']) {
      const period = periodFrom(start, 31);
      expect(period.periodEnd).toBe(expected);
      const nextDay = new Date(Date.parse(`${period.periodEnd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      start = nextDay;
    }
  });

  it('gives a new retainer a first period up to its next invoice day', () => {
    // Started before this month's invoice day: a short first period to it.
    expect(firstPeriod('2026-10-03', 15)).toEqual({ periodStart: '2026-10-03', periodEnd: '2026-10-14' });
    // Started after it: the first period runs to next month's.
    expect(firstPeriod('2026-10-20', 15)).toEqual({ periodStart: '2026-10-20', periodEnd: '2026-11-14' });
    // Started on the invoice day: a whole period.
    expect(firstPeriod('2026-10-15', 15)).toEqual({ periodStart: '2026-10-15', periodEnd: '2026-11-14' });
  });
});

describe('how a period’s minutes are spent', () => {
  const period = { includedMinutes: 600, rolloverMinutes: 120, usedMinutes: 0 };

  it('spends the carried minutes first, so they are worth having', () => {
    expect(splitUsage({ ...period, usedMinutes: 100 })).toMatchObject({
      fromRolloverMinutes: 100,
      fromIncludedMinutes: 0,
      overageMinutes: 0,
      remainingMinutes: 620,
      // None of this period's own minutes were touched, so all of them carry on.
      rollsOverMinutes: 600,
    });
  });

  it('carries only this period’s own unused minutes, so nothing rolls twice', () => {
    expect(splitUsage({ ...period, usedMinutes: 300 })).toMatchObject({
      fromRolloverMinutes: 120,
      fromIncludedMinutes: 180,
      rollsOverMinutes: 420,
      overageMinutes: 0,
    });
    // Everything allowed was used: nothing carries on.
    expect(splitUsage({ ...period, usedMinutes: 720 })).toMatchObject({
      overageMinutes: 0,
      remainingMinutes: 0,
      rollsOverMinutes: 0,
    });
  });

  it('counts what is left over as overage once everything allowed is gone', () => {
    expect(splitUsage({ ...period, usedMinutes: 900 })).toMatchObject({
      fromRolloverMinutes: 120,
      fromIncludedMinutes: 600,
      overageMinutes: 180,
      remainingMinutes: 0,
      rollsOverMinutes: 0,
    });
  });

  it('says where usage stands, counting the carried minutes in', () => {
    expect(usageBps({ includedMinutes: 600, rolloverMinutes: 0, usedMinutes: 480 })).toBe(8_000);
    expect(usageBps({ includedMinutes: 600, rolloverMinutes: 120, usedMinutes: 480 })).toBe(6_667);
    expect(usageBps({ includedMinutes: 600, rolloverMinutes: 0, usedMinutes: 900 })).toBe(15_000);
    // A retainer with no included minutes is fully used the moment anything is logged.
    expect(usageBps({ includedMinutes: 0, rolloverMinutes: 0, usedMinutes: 30 })).toBe(10_000);
  });
});
