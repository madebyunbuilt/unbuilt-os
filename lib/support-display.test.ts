import { describe, expect, it } from 'vitest';
import { compliance, lateness, monthLabel } from './support-display';

// How an SLA report reads (09-support-and-sla.md). A client reads these numbers as a judgement on the studio, so
// what they cannot mean matters as much as what they do.

describe('a report’s figures in words', () => {
  it('says nothing came up rather than claiming a perfect score', () => {
    // 100% against no tickets would be a claim about work that never existed.
    expect(compliance(undefined)).toBe('None raised');
    expect(compliance(10_000)).toBe('100%');
    expect(compliance(0)).toBe('0%');
    expect(compliance(6667)).toBe('66.7%');
  });

  it('names the month a report covers', () => {
    expect(monthLabel('2026-10-01')).toBe('October 2026');
    expect(monthLabel('2027-01-01')).toBe('January 2027');
  });

  it('counts lateness in business time, where a day is the working one', () => {
    expect(lateness(30)).toBe('30 minutes late');
    expect(lateness(300)).toBe('5 hours late');
    // Eight business hours is a day, not a third of one — and one day, not one days.
    expect(lateness(480)).toBe('1 business day late');
    expect(lateness(60)).toBe('1 hour late');
    expect(lateness(960)).toBe('2 business days late');
  });
});
