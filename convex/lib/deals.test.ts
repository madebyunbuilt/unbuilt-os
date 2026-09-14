import { describe, expect, it } from 'vitest';
import { DEAL_IDLE_MS, followUpReminders, pipelineTotals } from './deals';

describe('deal helpers', () => {
  it('weights pipeline value per deal and never mixes currencies', () => {
    expect(
      pipelineTotals([
        { valueMinor: 1_000, currency: 'NGN', probabilityBps: 2500 },
        { valueMinor: 3, currency: 'NGN', probabilityBps: 5000 },
        { valueMinor: 700, currency: 'USD', probabilityBps: 10000 },
      ]),
    ).toEqual({
      // 250 + 1.5 → 2 (half up), per deal.
      NGN: { count: 2, valueMinor: 1_003, weightedMinor: 252 },
      USD: { count: 1, valueMinor: 700, weightedMinor: 700 },
    });
  });

  it('decides follow-up and idle reminders', () => {
    const now = Date.parse('2026-09-30T16:00:00Z');
    const quiet = {
      lastActivityAt: now - DEAL_IDLE_MS,
      nextFollowUpDate: undefined,
      idleNotifiedAt: undefined,
      followUpNotifiedFor: undefined,
    };
    const at = { now, today: '2026-09-30', activityDate: '2026-09-23' };
    expect(followUpReminders(quiet, at)).toEqual({ idle: true, followUpDue: false });
    expect(followUpReminders({ ...quiet, idleNotifiedAt: now - 1 }, at).idle).toBe(false);
    expect(followUpReminders({ ...quiet, nextFollowUpDate: '2026-10-02' }, at).idle).toBe(false);
    expect(followUpReminders({ ...quiet, nextFollowUpDate: '2026-09-29' }, at)).toEqual({
      idle: true,
      followUpDue: true,
    });
    expect(
      followUpReminders({ ...quiet, nextFollowUpDate: '2026-09-29' }, { ...at, activityDate: '2026-09-29' })
        .followUpDue,
    ).toBe(false);
    expect(
      followUpReminders({ ...quiet, nextFollowUpDate: '2026-09-29', followUpNotifiedFor: '2026-09-29' }, at)
        .followUpDue,
    ).toBe(false);
  });
});
