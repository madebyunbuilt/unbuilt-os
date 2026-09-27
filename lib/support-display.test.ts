import { describe, expect, it } from 'vitest';
import { ago, compliance, lateness, monthLabel, renewal, uptime } from './support-display';

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

describe('how a monitor reads', () => {
  it('does not call an unchecked monitor perfect', () => {
    expect(uptime(undefined)).toBe('Not checked yet');
    expect(uptime(10_000)).toBe('100.00%');
  });

  it('keeps the decimals that matter near the top', () => {
    // The difference between these two is the whole reason for measuring.
    expect(uptime(9990)).toBe('99.90%');
    expect(uptime(9999)).toBe('99.99%');
    // Far from the top, a decimal place is enough.
    expect(uptime(8750)).toBe('87.5%');
  });

  it('says how long ago in words', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(ago(now - 30_000, now)).toBe('just now');
    expect(ago(now - 12 * 60_000, now)).toBe('12 minutes ago');
    expect(ago(now - 3 * 60 * 60_000, now)).toBe('3 hours ago');
    expect(ago(undefined, now)).toBe('never');
  });
});

describe('how near a renewal is', () => {
  it('makes a lapsed asset the loudest thing on the page', () => {
    expect(renewal(-1, 'active')).toEqual({ label: 'Lapsed 1 day ago', tone: 'attention' });
    expect(renewal(-12, 'active')).toEqual({ label: 'Lapsed 12 days ago', tone: 'attention' });
  });

  it('reads today and tomorrow as words, not as numbers', () => {
    expect(renewal(0, 'active').label).toBe('Renews today');
    expect(renewal(1, 'active').label).toBe('Renews tomorrow');
  });

  it('grows quieter the further off it is', () => {
    expect(renewal(7, 'active').tone).toBe('attention');
    expect(renewal(30, 'active').tone).toBe('draft');
    expect(renewal(200, 'active').tone).toBe('muted');
  });

  it('says an asset handed over is no longer the studio’s to renew', () => {
    // A transferred asset has a date in the past and still must not shout.
    expect(renewal(-40, 'transferred')).toEqual({ label: 'Theirs now', tone: 'muted' });
  });
});
