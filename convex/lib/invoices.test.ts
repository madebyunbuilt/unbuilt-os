import { describe, expect, it } from 'vitest';
import { reminderDue } from './invoices';

// The reminder schedule (08-billing-and-finance.md, Reminders), day by day around a due date of 1 October.

describe('reminderDue', () => {
  const due = '2026-10-01';
  it('fires 3 days before, on the day, and 3, 7 and 14 days after', () => {
    expect(reminderDue(due, '2026-09-27', [])).toBeNull();
    expect(reminderDue(due, '2026-09-28', [])).toBe('before_3');
    expect(reminderDue(due, '2026-10-01', ['before_3'])).toBe('due');
    expect(reminderDue(due, '2026-10-04', ['before_3', 'due'])).toBe('after_3');
    expect(reminderDue(due, '2026-10-08', ['before_3', 'due', 'after_3'])).toBe('after_7');
    expect(reminderDue(due, '2026-10-15', ['before_3', 'due', 'after_3', 'after_7'])).toBe('after_14');
  });

  it('then weekly, each once', () => {
    const sent = ['before_3', 'due', 'after_3', 'after_7', 'after_14'];
    expect(reminderDue(due, '2026-10-21', sent)).toBeNull();
    expect(reminderDue(due, '2026-10-22', sent)).toBe('weekly_1');
    expect(reminderDue(due, '2026-10-25', [...sent, 'weekly_1'])).toBeNull();
    expect(reminderDue(due, '2026-10-29', [...sent, 'weekly_1'])).toBe('weekly_2');
  });

  it('sends nothing twice, and after a missed day only the latest', () => {
    expect(reminderDue(due, '2026-09-29', ['before_3'])).toBeNull();
    // The run missed 1 October: on the 2nd it sends "due", never the stale "3 days before".
    expect(reminderDue(due, '2026-10-02', [])).toBe('due');
    // Created long after its due date: one overdue reminder, not the whole back catalogue.
    expect(reminderDue(due, '2026-11-01', [])).toBe('weekly_2');
  });
});
