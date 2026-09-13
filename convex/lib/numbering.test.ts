import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from '../schema';
import { modules } from '../test.setup';
import { DEFAULT_NUMBERING, ensureCounterAtLeast, formatNumber, nextNumber } from './numbering';

describe('formatNumber', () => {
  it('uses the default formats from the spec', () => {
    expect(formatNumber(1, DEFAULT_NUMBERING.invoice)).toBe('UNB-INV-0001');
    expect(formatNumber(42, DEFAULT_NUMBERING.changeRequest)).toBe('UNB-CR-0042');
    expect(formatNumber(7, DEFAULT_NUMBERING.project)).toBe('UNB-P-0007');
  });

  it('keeps every digit past the padding', () => {
    expect(formatNumber(12_345, DEFAULT_NUMBERING.ticket)).toBe('UNB-TKT-12345');
  });

  it('rejects zero, negatives and fractions', () => {
    expect(() => formatNumber(0, DEFAULT_NUMBERING.invoice)).toThrow();
    expect(() => formatNumber(-1, DEFAULT_NUMBERING.invoice)).toThrow();
    expect(() => formatNumber(1.5, DEFAULT_NUMBERING.invoice)).toThrow();
  });
});

describe('nextNumber', () => {
  it('starts at 1 and counts each record type separately', async () => {
    const t = convexTest(schema, modules);
    const numbers = await t.run(async (ctx) => [
      await nextNumber(ctx, 'invoice'),
      await nextNumber(ctx, 'invoice'),
      await nextNumber(ctx, 'receipt'),
    ]);
    expect(numbers).toEqual(['UNB-INV-0001', 'UNB-INV-0002', 'UNB-RCT-0001']);
  });

  it('applies a configured format', async () => {
    const t = convexTest(schema, modules);
    const number = await t.run((ctx) => nextNumber(ctx, 'invoice', { prefix: 'INV/', padding: 6 }));
    expect(number).toBe('INV/000001');
  });

  it('never produces duplicates or gaps when many transactions run at once', async () => {
    const t = convexTest(schema, modules);
    const count = 100;
    const numbers = await Promise.all(Array.from({ length: count }, () => t.run((ctx) => nextNumber(ctx, 'invoice'))));

    const expected = Array.from({ length: count }, (_, i) => formatNumber(i + 1, DEFAULT_NUMBERING.invoice));
    expect(new Set(numbers).size).toBe(count);
    expect([...numbers].sort()).toEqual(expected);
  });

  it('keeps a single counter row per record type', async () => {
    const t = convexTest(schema, modules);
    await Promise.all(Array.from({ length: 10 }, () => t.run((ctx) => nextNumber(ctx, 'quote'))));
    const rows = await t.run((ctx) => ctx.db.query('counters').collect());
    expect(rows).toEqual([expect.objectContaining({ key: 'quote', value: 10 })]);
  });
});

describe('ensureCounterAtLeast', () => {
  it('moves new numbers above the highest imported number', async () => {
    const t = convexTest(schema, modules);
    const number = await t.run(async (ctx) => {
      await ensureCounterAtLeast(ctx, 'invoice', 310);
      return await nextNumber(ctx, 'invoice');
    });
    expect(number).toBe('UNB-INV-0311');
  });

  it('never lowers a counter', async () => {
    const t = convexTest(schema, modules);
    const number = await t.run(async (ctx) => {
      await ensureCounterAtLeast(ctx, 'invoice', 50);
      await ensureCounterAtLeast(ctx, 'invoice', 10);
      return await nextNumber(ctx, 'invoice');
    });
    expect(number).toBe('UNB-INV-0051');
  });
});
