import { describe, expect, it } from 'vitest';
import {
  type Discount,
  type LineInput,
  type TaxSetting,
  type Totals,
  calculateTotals,
  formatMoney,
  invoiceBalance,
  lineAmountMinor,
  maxCreditNoteMinor,
  MoneyError,
  mulDivRoundHalfUp,
  parseMoneyInput,
  toNgnMinor,
} from './money';

const none: Discount = { kind: 'none' };
const vat = (applies: boolean): TaxSetting => ({ applies, bps: 750 });
const wht = (applies: boolean, bps = 500): TaxSetting => ({ applies, bps });
const line = (quantityMilli: number, unitPriceMinor: number, taxable = true): LineInput => ({
  quantityMilli,
  unitPriceMinor,
  taxable,
});

type Fixture = {
  name: string;
  lines: LineInput[];
  discount: Discount;
  vat: TaxSetting;
  wht: TaxSetting;
  lineAmountsMinor: number[];
  totals: Totals;
};

// Expected values were worked by hand (and cross-checked with BigInt arithmetic), not produced by money.ts.
const fixtures: Fixture[] = [
  {
    name: 'single taxable line, VAT on, WHT off',
    lines: [line(1_000, 100_000_000)],
    discount: none,
    vat: vat(true),
    wht: wht(false),
    lineAmountsMinor: [100_000_000],
    totals: {
      subtotalMinor: 100_000_000,
      discountMinor: 0,
      taxableMinor: 100_000_000,
      vatMinor: 7_500_000,
      totalMinor: 107_500_000,
      whtExpectedMinor: 0,
    },
  },
  {
    name: 'mixed taxable lines, percent discount shared, VAT and WHT on',
    lines: [line(1_000, 100_000_000), line(1_000, 5_000_000, false)],
    discount: { kind: 'percent', bps: 1_000 },
    vat: vat(true),
    wht: wht(true),
    lineAmountsMinor: [100_000_000, 5_000_000],
    totals: {
      subtotalMinor: 105_000_000,
      discountMinor: 10_500_000,
      taxableMinor: 90_000_000,
      vatMinor: 6_750_000,
      totalMinor: 101_250_000,
      whtExpectedMinor: 4_725_000,
    },
  },
  {
    name: 'fractional quantity rounds half up, VAT off, WHT on',
    lines: [line(3_000, 250_000), line(1_500, 199_999)],
    discount: none,
    vat: vat(false),
    wht: wht(true),
    lineAmountsMinor: [750_000, 299_999],
    totals: {
      subtotalMinor: 1_049_999,
      discountMinor: 0,
      taxableMinor: 1_049_999,
      vatMinor: 0,
      totalMinor: 1_049_999,
      whtExpectedMinor: 52_500,
    },
  },
  {
    name: 'fixed discount shared across mixed lines with rounding at each step',
    lines: [line(333, 1_000_000), line(2_125, 12_345, false)],
    discount: { kind: 'fixed', amountMinor: 59_233 },
    vat: vat(true),
    wht: wht(true, 1_000),
    lineAmountsMinor: [333_000, 26_233],
    totals: {
      subtotalMinor: 359_233,
      discountMinor: 59_233,
      taxableMinor: 278_092,
      vatMinor: 20_857,
      totalMinor: 320_857,
      whtExpectedMinor: 30_000,
    },
  },
  {
    name: 'fixed discount larger than subtotal is capped',
    lines: [line(1_000, 50_000)],
    discount: { kind: 'fixed', amountMinor: 80_000 },
    vat: vat(true),
    wht: wht(true),
    lineAmountsMinor: [50_000],
    totals: {
      subtotalMinor: 50_000,
      discountMinor: 50_000,
      taxableMinor: 0,
      vatMinor: 0,
      totalMinor: 0,
      whtExpectedMinor: 0,
    },
  },
  {
    name: 'VAT and WHT exactly on a half round up',
    lines: [line(1_000, 20)],
    discount: none,
    vat: vat(true),
    wht: wht(true),
    lineAmountsMinor: [20],
    totals: { subtotalMinor: 20, discountMinor: 0, taxableMinor: 20, vatMinor: 2, totalMinor: 22, whtExpectedMinor: 1 },
  },
  {
    name: 'percent discount rounds before VAT is calculated',
    lines: [line(1_000, 333)],
    discount: { kind: 'percent', bps: 1_250 },
    vat: vat(true),
    wht: wht(true),
    lineAmountsMinor: [333],
    totals: {
      subtotalMinor: 333,
      discountMinor: 42,
      taxableMinor: 291,
      vatMinor: 22,
      totalMinor: 313,
      whtExpectedMinor: 15,
    },
  },
  {
    name: 'only non-taxable lines charge no VAT even when VAT applies',
    lines: [line(2_000, 1_000_000, false)],
    discount: none,
    vat: vat(true),
    wht: wht(false),
    lineAmountsMinor: [2_000_000],
    totals: {
      subtotalMinor: 2_000_000,
      discountMinor: 0,
      taxableMinor: 0,
      vatMinor: 0,
      totalMinor: 2_000_000,
      whtExpectedMinor: 0,
    },
  },
  {
    name: 'large amounts keep full precision',
    lines: [line(1_000_000, 50_000_000_000)],
    discount: none,
    vat: vat(true),
    wht: wht(true),
    lineAmountsMinor: [50_000_000_000_000],
    totals: {
      subtotalMinor: 50_000_000_000_000,
      discountMinor: 0,
      taxableMinor: 50_000_000_000_000,
      vatMinor: 3_750_000_000_000,
      totalMinor: 53_750_000_000_000,
      whtExpectedMinor: 2_500_000_000_000,
    },
  },
  {
    name: 'no lines',
    lines: [],
    discount: { kind: 'percent', bps: 1_000 },
    vat: vat(true),
    wht: wht(true),
    lineAmountsMinor: [],
    totals: { subtotalMinor: 0, discountMinor: 0, taxableMinor: 0, vatMinor: 0, totalMinor: 0, whtExpectedMinor: 0 },
  },
];

describe('calculateTotals', () => {
  it.each(fixtures)('$name', ({ lines, discount, vat, wht, lineAmountsMinor, totals }) => {
    expect(calculateTotals({ lines, discount, vat, wht })).toEqual({ lineAmountsMinor, totals });
  });

  it('keeps total = subtotal − discount + VAT for every fixture', () => {
    for (const { totals } of fixtures) {
      expect(totals.totalMinor).toBe(totals.subtotalMinor - totals.discountMinor + totals.vatMinor);
    }
  });

  it.each([
    ['negative quantity', [line(-1_000, 100)], none],
    ['negative unit price', [line(1_000, -100)], none],
    ['fractional minor units', [line(1_000, 10.5)], none],
    ['discount over 100%', [line(1_000, 100)], { kind: 'percent', bps: 10_001 } as Discount],
    ['negative fixed discount', [line(1_000, 100)], { kind: 'fixed', amountMinor: -1 } as Discount],
  ])('rejects %s', (_, lines, discount) => {
    expect(() => calculateTotals({ lines, discount, vat: vat(true), wht: wht(false) })).toThrow(MoneyError);
  });

  it('rejects tax rates over 100%', () => {
    const lines = [line(1_000, 100)];
    expect(() =>
      calculateTotals({ lines, discount: none, vat: { applies: true, bps: 10_001 }, wht: wht(false) }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateTotals({ lines, discount: none, vat: vat(false), wht: { applies: true, bps: 20_000 } }),
    ).toThrow(MoneyError);
  });
});

describe('rounding primitives', () => {
  it('rounds half up', () => {
    expect(mulDivRoundHalfUp(1, 1, 2)).toBe(1);
    expect(mulDivRoundHalfUp(1, 1, 3)).toBe(0);
    expect(mulDivRoundHalfUp(2, 1, 3)).toBe(1);
    expect(lineAmountMinor(1_500, 3)).toBe(5); // 4.5
    expect(lineAmountMinor(1_499, 3)).toBe(4); // 4.497
  });

  it('refuses results beyond safe integers', () => {
    expect(() => mulDivRoundHalfUp(Number.MAX_SAFE_INTEGER, 2, 1)).toThrow(MoneyError);
  });
});

describe('invoiceBalance', () => {
  const totalMinor = 107_500_000;

  it('is unpaid with nothing applied', () => {
    expect(invoiceBalance({ totalMinor, paidMinor: 0, whtCreditedMinor: 0, creditedMinor: 0 })).toEqual({
      balanceMinor: totalMinor,
      settled: false,
      partiallySettled: false,
    });
  });

  it('is partially settled after a partial payment', () => {
    expect(invoiceBalance({ totalMinor, paidMinor: 50_000_000, whtCreditedMinor: 0, creditedMinor: 0 })).toEqual({
      balanceMinor: 57_500_000,
      settled: false,
      partiallySettled: true,
    });
  });

  it('is settled when payment + WHT credited + credit notes equal the total', () => {
    expect(
      invoiceBalance({ totalMinor, paidMinor: 97_500_000, whtCreditedMinor: 5_000_000, creditedMinor: 5_000_000 }),
    ).toEqual({ balanceMinor: 0, settled: true, partiallySettled: false });
  });

  it('stays partially settled one kobo short', () => {
    const result = invoiceBalance({
      totalMinor,
      paidMinor: 97_500_000,
      whtCreditedMinor: 5_000_000,
      creditedMinor: 4_999_999,
    });
    expect(result).toEqual({ balanceMinor: 1, settled: false, partiallySettled: true });
  });

  it('rejects overpayment', () => {
    expect(() => invoiceBalance({ totalMinor, paidMinor: totalMinor, whtCreditedMinor: 1, creditedMinor: 0 })).toThrow(
      MoneyError,
    );
  });
});

describe('maxCreditNoteMinor', () => {
  it('is the total minus existing credits, never negative', () => {
    expect(maxCreditNoteMinor(100_000, 0)).toBe(100_000);
    expect(maxCreditNoteMinor(100_000, 30_000)).toBe(70_000);
    expect(maxCreditNoteMinor(100_000, 100_000)).toBe(0);
  });
});

describe('toNgnMinor', () => {
  it('converts with the stored rate', () => {
    // $150.00 at ₦1,550.25 per USD = ₦232,537.50
    expect(toNgnMinor(15_000, 'USD', 1_550_250_000)).toBe(23_253_750);
  });

  it('rounds the converted amount half up', () => {
    expect(toNgnMinor(1, 'EUR', 1_550_255_555)).toBe(1_550);
    expect(toNgnMinor(1, 'EUR', 1_550_500_000)).toBe(1_551);
  });

  it('leaves NGN unchanged and ignores the rate', () => {
    expect(toNgnMinor(123_456, 'NGN', 0)).toBe(123_456);
  });

  it('requires a rate for other currencies', () => {
    expect(() => toNgnMinor(100, 'USD', 0)).toThrow(MoneyError);
  });
});

describe('formatMoney', () => {
  it('formats minor units in the currency locale', () => {
    expect(formatMoney(123_456_789, 'NGN')).toBe('₦1,234,567.89');
    expect(formatMoney(5, 'USD')).toBe('$0.05');
    expect(formatMoney(-150, 'USD')).toBe('-$1.50');
    expect(formatMoney(100_000, 'EUR')).toBe('€1,000.00');
  });

  it('formats amounts beyond float precision exactly', () => {
    expect(formatMoney(9_007_199_254_740_991, 'NGN')).toBe('₦90,071,992,547,409.91');
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['1,250,000.5', 125_000_050],
    ['0.05', 5],
    ['12', 1_200],
    [' 7. ', 700],
  ])('parses %s', (input, expected) => {
    expect(parseMoneyInput(input, 'NGN')).toBe(expected);
  });

  it.each(['-1', '1.234', 'abc', '', '.5'])('rejects %j', (input) => {
    expect(() => parseMoneyInput(input, 'NGN')).toThrow(MoneyError);
  });
});
