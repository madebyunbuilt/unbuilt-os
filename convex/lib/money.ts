import { ConvexError } from 'convex/values';

// The only place money is calculated. Rules: docs/spec/04-data-model.md (Money, Foreign exchange).
// Amounts are integer minor units, percentages are basis points, quantities are thousandths. Intermediate products
// use BigInt so large amounts never lose precision.

export const CURRENCIES = {
  NGN: { minorDigits: 2, locale: 'en-NG' },
  USD: { minorDigits: 2, locale: 'en-US' },
  EUR: { minorDigits: 2, locale: 'en-IE' },
} as const;

export type Currency = keyof typeof CURRENCIES;

export const BPS_PER_WHOLE = 10_000;
export const MILLI_PER_UNIT = 1_000;
export const MICRO_PER_UNIT = 1_000_000;

export class MoneyError extends ConvexError<{ code: 'money.invalid'; message: string }> {
  constructor(message: string) {
    super({ code: 'money.invalid', message });
  }
}

function assertNonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`${name} must be a non-negative whole number, got ${value}`);
  }
}

function assertBps(bps: number, name: string) {
  assertNonNegativeInteger(bps, name);
  if (bps > BPS_PER_WHOLE) throw new MoneyError(`${name} cannot exceed 100% (10000 bps), got ${bps}`);
}

export function isCurrency(value: string): value is Currency {
  return Object.hasOwn(CURRENCIES, value);
}

/** `a × b ÷ denominator`, rounded half up. Inputs must be non-negative safe integers. */
export function mulDivRoundHalfUp(a: number, b: number, denominator: number): number {
  assertNonNegativeInteger(a, 'amount');
  assertNonNegativeInteger(b, 'multiplier');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new MoneyError('denominator must be positive');

  const product = BigInt(a) * BigInt(b);
  const d = BigInt(denominator);
  const rounded = (product * 2n + d) / (d * 2n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError('amount is too large');
  return Number(rounded);
}

/** Step 1: quantity (thousandths) × unit price. */
export function lineAmountMinor(quantityMilli: number, unitPriceMinor: number): number {
  return mulDivRoundHalfUp(quantityMilli, unitPriceMinor, MILLI_PER_UNIT);
}

export function applyBps(amountMinor: number, bps: number): number {
  assertBps(bps, 'rate');
  return mulDivRoundHalfUp(amountMinor, bps, BPS_PER_WHOLE);
}

export type Discount = { kind: 'none' } | { kind: 'percent'; bps: number } | { kind: 'fixed'; amountMinor: number };

export type TaxSetting = { applies: boolean; bps: number };

export type LineInput = { quantityMilli: number; unitPriceMinor: number; taxable: boolean };

export type Totals = {
  subtotalMinor: number;
  discountMinor: number;
  /** The VAT base: taxable lines after their share of the discount. */
  taxableMinor: number;
  vatMinor: number;
  totalMinor: number;
  whtExpectedMinor: number;
};

export type TotalsInput = { lines: LineInput[]; discount: Discount; vat: TaxSetting; wht: TaxSetting };

/**
 * Invoice, quote and credit note totals, in the order from 04-data-model.md:
 * lines → subtotal → discount → VAT on taxable lines → total → expected WHT on the amount after discount, before VAT.
 * A discount is shared between taxable and non-taxable lines in proportion to their amounts.
 */
export function calculateTotals({ lines, discount, vat, wht }: TotalsInput): {
  lineAmountsMinor: number[];
  totals: Totals;
} {
  const lineAmountsMinor = lines.map((line) => lineAmountMinor(line.quantityMilli, line.unitPriceMinor));
  const subtotalMinor = checkedSum(lineAmountsMinor);
  const taxableSubtotalMinor = checkedSum(lineAmountsMinor.filter((_, i) => lines[i].taxable));

  const discountMinor = discountAmountMinor(subtotalMinor, discount);
  const netMinor = subtotalMinor - discountMinor;

  const taxableDiscountMinor =
    subtotalMinor === 0 ? 0 : mulDivRoundHalfUp(discountMinor, taxableSubtotalMinor, subtotalMinor);
  const taxableMinor = taxableSubtotalMinor - taxableDiscountMinor;

  assertBps(vat.bps, 'VAT rate');
  assertBps(wht.bps, 'WHT rate');
  const vatMinor = vat.applies ? applyBps(taxableMinor, vat.bps) : 0;
  const whtExpectedMinor = wht.applies ? applyBps(netMinor, wht.bps) : 0;

  return {
    lineAmountsMinor,
    totals: {
      subtotalMinor,
      discountMinor,
      taxableMinor,
      vatMinor,
      totalMinor: checkedSum([netMinor, vatMinor]),
      whtExpectedMinor,
    },
  };
}

function discountAmountMinor(subtotalMinor: number, discount: Discount): number {
  switch (discount.kind) {
    case 'none':
      return 0;
    case 'percent':
      assertBps(discount.bps, 'discount');
      return applyBps(subtotalMinor, discount.bps);
    case 'fixed':
      assertNonNegativeInteger(discount.amountMinor, 'discount');
      return Math.min(discount.amountMinor, subtotalMinor);
  }
}

function checkedSum(amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertNonNegativeInteger(amount, 'amount');
    total += amount;
    if (!Number.isSafeInteger(total)) throw new MoneyError('amount is too large');
  }
  return total;
}

export type Settlement = { totalMinor: number; paidMinor: number; whtCreditedMinor: number; creditedMinor: number };

/**
 * An invoice is settled when paid + WHT credited + credit notes = total (08-billing-and-finance.md).
 * Overpayment is rejected rather than stored as a negative balance.
 */
export function invoiceBalance({ totalMinor, paidMinor, whtCreditedMinor, creditedMinor }: Settlement): {
  balanceMinor: number;
  settled: boolean;
  partiallySettled: boolean;
} {
  const appliedMinor = checkedSum([paidMinor, whtCreditedMinor, creditedMinor]);
  assertNonNegativeInteger(totalMinor, 'total');
  if (appliedMinor > totalMinor) {
    throw new MoneyError(`payments and credits (${appliedMinor}) exceed the invoice total (${totalMinor})`);
  }
  const balanceMinor = totalMinor - appliedMinor;
  return { balanceMinor, settled: balanceMinor === 0, partiallySettled: appliedMinor > 0 && balanceMinor > 0 };
}

/** A credit note can never exceed the invoice total minus existing credits. */
export function maxCreditNoteMinor(totalMinor: number, existingCreditsMinor: number): number {
  assertNonNegativeInteger(totalMinor, 'total');
  assertNonNegativeInteger(existingCreditsMinor, 'existing credits');
  return Math.max(0, totalMinor - existingCreditsMinor);
}

/** Converts with the record's stored rate: NGN per one unit of `currency`, times 1,000,000. */
export function toNgnMinor(amountMinor: number, currency: Currency, fxRateToNgnMicro: number): number {
  if (currency === 'NGN') {
    assertNonNegativeInteger(amountMinor, 'amount');
    return amountMinor;
  }
  if (!Number.isSafeInteger(fxRateToNgnMicro) || fxRateToNgnMicro <= 0) {
    throw new MoneyError(`an FX rate is required to convert ${currency} to NGN`);
  }
  // Rescale when the currencies use different numbers of minor digits, without leaving integer arithmetic.
  const digitGap = CURRENCIES.NGN.minorDigits - CURRENCIES[currency].minorDigits;
  const rate = digitGap >= 0 ? fxRateToNgnMicro * 10 ** digitGap : fxRateToNgnMicro;
  const denominator = digitGap >= 0 ? MICRO_PER_UNIT : MICRO_PER_UNIT * 10 ** -digitGap;
  return mulDivRoundHalfUp(amountMinor, rate, denominator);
}

/** Display only. Builds the decimal string from integers so formatting never goes through a float. */
export function formatMoney(amountMinor: number, currency: Currency, locale: string = CURRENCIES[currency].locale) {
  if (!Number.isSafeInteger(amountMinor)) throw new MoneyError('amount must be a whole number of minor units');
  const digits = CURRENCIES[currency].minorDigits;
  const abs = Math.abs(amountMinor)
    .toString()
    .padStart(digits + 1, '0');
  const decimal = `${amountMinor < 0 ? '-' : ''}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(decimal as `${number}`);
}

/** Parses user input such as "1,250,000.5" into minor units. Rejects negatives and extra decimal places. */
/**
 * The same amount with the currency's code rather than its symbol: "NGN 20,750.00". PDFs use this because the standard
 * PDF fonts have no ₦, which would otherwise print as a broken glyph.
 */
export function formatMoneyWithCode(amountMinor: number, currency: Currency): string {
  const { minorDigits, locale } = CURRENCIES[currency];
  const amount = amountMinor / 10 ** minorDigits;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: minorDigits,
    maximumFractionDigits: minorDigits,
  }).format(amount);
  return `${currency} ${formatted}`;
}

export function parseMoneyInput(input: string, currency: Currency): number {
  const digits = CURRENCIES[currency].minorDigits;
  const cleaned = input.trim().replace(/[,\s]/g, '');
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{0,${digits}}))?$`).exec(cleaned);
  if (!match) throw new MoneyError(`"${input}" is not a valid ${currency} amount`);
  const minor = Number(BigInt(match[1]) * 10n ** BigInt(digits) + BigInt((match[2] ?? '').padEnd(digits, '0') || '0'));
  if (!Number.isSafeInteger(minor)) throw new MoneyError('amount is too large');
  return minor;
}

/** Parses a percentage typed by a person, such as "7.5", into basis points. At most two decimal places, 0 to 100. */
export function parsePercentToBps(input: string): number {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(input.trim().replace(/%$/, '').trim());
  if (!match) throw new MoneyError(`"${input}" is not a percentage with at most two decimal places`);
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  if (bps > BPS_PER_WHOLE) throw new MoneyError('A percentage cannot be more than 100');
  return bps;
}

/** Basis points as a percentage for display: 750 → "7.5", 1000 → "10". */
export function formatBpsAsPercent(bps: number): string {
  assertBps(bps, 'rate');
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * The VAT inside a credit note, in the invoice's own proportion (studio, 2026-09-22): crediting part of an invoice
 * reverses net and VAT in the same share as the invoice charged them.
 */
export function creditNoteVatSplit(
  amountMinor: number,
  invoice: { vatMinor: number; totalMinor: number },
): { netMinor: number; vatMinor: number } {
  assertNonNegativeInteger(amountMinor, 'credit');
  if (invoice.totalMinor === 0 || invoice.vatMinor === 0) return { netMinor: amountMinor, vatMinor: 0 };
  const vatMinor = mulDivRoundHalfUp(amountMinor, invoice.vatMinor, invoice.totalMinor);
  return { netMinor: amountMinor - vatMinor, vatMinor };
}

/**
 * A credit note clears what its invoice still owes, and the rest is held as client credit (studio, 2026-09-22): a
 * ₦50,000 credit on an invoice with ₦40,000 left applies ₦40,000 and holds ₦10,000.
 */
export function splitCredit(amountMinor: number, balanceMinor: number): { appliedMinor: number; heldMinor: number } {
  assertNonNegativeInteger(amountMinor, 'credit');
  assertNonNegativeInteger(balanceMinor, 'balance');
  const appliedMinor = Math.min(amountMinor, balanceMinor);
  return { appliedMinor, heldMinor: amountMinor - appliedMinor };
}

export type Movement = { debitMinor: number; creditMinor: number };

/**
 * A statement's running balance: each line adds its debit and takes off its credit. The balance can go below zero,
 * which means the client is in credit.
 */
export function runningBalances(openingMinor: number, moves: Movement[]): { balances: number[]; closingMinor: number } {
  if (!Number.isSafeInteger(openingMinor)) throw new MoneyError('opening balance must be a whole number');
  let balance = openingMinor;
  const balances = moves.map((move) => {
    assertNonNegativeInteger(move.debitMinor, 'debit');
    assertNonNegativeInteger(move.creditMinor, 'credit');
    balance += move.debitMinor - move.creditMinor;
    if (!Number.isSafeInteger(balance)) throw new MoneyError('amount is too large');
    return balance;
  });
  return { balances, closingMinor: balance };
}

/**
 * The WHT a client can still be expected to withhold, once part of the invoice has been credited: the expected WHT in
 * the same share as what is still owed of the total. A ₦6,000 expectation on a ₦215,000 invoice with ₦100,000 left is
 * ₦2,790.70.
 */
export function whtExpectedOnBalance(
  invoice: { whtExpectedMinor: number; totalMinor: number },
  balanceMinor: number,
): number {
  assertNonNegativeInteger(balanceMinor, 'balance');
  if (invoice.totalMinor === 0) return 0;
  return mulDivRoundHalfUp(invoice.whtExpectedMinor, Math.min(balanceMinor, invoice.totalMinor), invoice.totalMinor);
}

/**
 * The WHT a client withholds alongside a payment of `cashMinor`, in the invoice's own proportion: the payment and its
 * WHT together settle a share of the invoice, and the WHT is that share of the expected WHT. ₦10,000 received on an
 * invoice expecting ₦6,000 WHT on ₦215,000 comes with ₦287.08. Never more than what is left after the payment.
 */
export function whtForPayment(
  cashMinor: number,
  invoice: { whtExpectedMinor: number; totalMinor: number },
  balanceMinor: number,
): number {
  assertNonNegativeInteger(cashMinor, 'payment');
  assertNonNegativeInteger(balanceMinor, 'balance');
  const rest = invoice.totalMinor - invoice.whtExpectedMinor;
  if (invoice.whtExpectedMinor === 0 || rest <= 0) return 0;
  return Math.max(0, Math.min(mulDivRoundHalfUp(cashMinor, invoice.whtExpectedMinor, rest), balanceMinor - cashMinor));
}
