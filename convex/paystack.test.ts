import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { describeChannel, paymentReference, sameSignature, signatureFor } from './lib/paystack';
import { createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

// Card payments (08-billing-and-finance.md, Paystack). What matters here: a payment is recorded only from an event
// whose signature verified, the same event twice records one payment, the amount and currency must match the invoice,
// and the withheld tax the client kept back is recorded with it.

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;
let clientId: Id<'clients'>;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-23T09:00:00+01:00'));
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_secret');
  t = newTest();
  roles = await seedRoles(t);
  await t.mutation(internal.seed.run, {});
  clientId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('clients', {
      displayName: 'Glossup',
      kind: 'company',
      status: 'active',
      country: 'NG',
      vatTreatment: 'exempt',
      whtApplies: false,
      defaultCurrency: 'NGN',
      timezone: 'Africa/Lagos',
      tags: [],
      portalEnabled: false,
    });
    await ctx.db.insert('contacts', {
      clientId: id,
      name: 'Ada Obi',
      email: 'ada@glossup.com',
      isPrimary: true,
      isBilling: true,
      portalAccess: false,
      status: 'active',
    });
    return id;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const owner = () => createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio' });
const invoice = (id: Id<'invoices'>) => t.run((ctx) => ctx.db.get('invoices', id));

async function sentInvoice(as: Awaited<ReturnType<typeof owner>>['as'], memberId: Id<'teamMembers'>, naira: number) {
  const invoiceId = await as.mutation(api.invoices.create, {
    clientId,
    lineItems: [{ description: 'Work', quantityMilli: 1_000, unitPriceMinor: naira * 100 }],
  });
  await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId });
  await t.mutation(internal.invoices.markSent, { invoiceId, memberId, recipientContactIds: [] });
  return invoiceId;
}

describe('the webhook', () => {
  it('signs and checks in constant time, and refuses a wrong signature', async () => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'inv_x_1' } });
    const signature = await signatureFor(body);
    expect(signature).toHaveLength(128);
    expect(sameSignature(signature, await signatureFor(body))).toBe(true);
    expect(sameSignature(signature, await signatureFor(`${body} `))).toBe(false);
    expect(sameSignature(signature, 'short')).toBe(false);
  });

  it('stores an event once, so the same delivery twice is processed once', async () => {
    const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'inv_x_1' } });
    const first = await t.mutation(internal.paystack.recordEvent, {
      eventId: 'evt_1',
      type: 'charge.success',
      payload,
    });
    const second = await t.mutation(internal.paystack.recordEvent, {
      eventId: 'evt_1',
      type: 'charge.success',
      payload,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await t.run((ctx) => ctx.db.query('webhookEvents').collect())).toHaveLength(1);
  });
});

describe('how the client paid', () => {
  it('says it in the studio’s words, from the channel Paystack reports', () => {
    expect(describeChannel('card', { brand: 'visa', last4: '4081', bank: 'TEST BANK' })).toEqual({
      channel: 'card',
      instrument: 'Card · visa ending 4081',
    });
    expect(describeChannel('bank_transfer', { bank: 'GTBank' })).toEqual({
      channel: 'bank_transfer',
      instrument: 'Bank transfer · GTBank',
    });
    expect(describeChannel('ussd', undefined)).toEqual({ channel: 'ussd', instrument: 'USSD' });
    expect(describeChannel(undefined, undefined)).toEqual({ channel: 'unknown', instrument: 'Paystack' });
  });
});

describe('recording a card payment', () => {
  it('settles the invoice, keeps the fee, makes a receipt and tells the studio', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    const reference = paymentReference(invoiceId, 1);

    await t.mutation(internal.payments.recordFromPaystack, {
      reference,
      amountMinor: 10_000_000,
      currency: 'NGN',
      feesMinor: 160_000,
      paystackTransactionId: '778899',
      paystackChannel: 'card',
      paystackInstrument: 'Card · visa ending 4081',
      whtMinor: 0,
    });

    expect(await invoice(invoiceId)).toMatchObject({ status: 'paid', paidMinor: 10_000_000, balanceMinor: 0 });
    const payment = await t.run((ctx) => ctx.db.query('payments').first());
    expect(payment).toMatchObject({
      method: 'paystack',
      status: 'succeeded',
      feesMinor: 160_000,
      paystackTransactionId: '778899',
      paystackInstrument: 'Card · visa ending 4081',
      reference,
    });
    expect(await t.run((ctx) => ctx.db.query('receipts').first())).toMatchObject({ number: 'UNB-RCT-0001' });
    const notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices.some((notice) => notice.event === 'invoice_paid')).toBe(true);
  });

  it('records the same reference once, however often Paystack sends it', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    const args = {
      reference: paymentReference(invoiceId, 1),
      amountMinor: 5_000_000,
      currency: 'NGN',
      paystackTransactionId: '1',
      whtMinor: 0,
    };
    await t.mutation(internal.payments.recordFromPaystack, args);
    await t.mutation(internal.payments.recordFromPaystack, args);
    expect(await t.run((ctx) => ctx.db.query('payments').collect())).toHaveLength(1);
    expect((await invoice(invoiceId))?.paidMinor).toBe(5_000_000);
  });

  it('records the tax a client withheld with the payment', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await t.mutation(internal.payments.recordFromPaystack, {
      reference: paymentReference(invoiceId, 1),
      amountMinor: 9_500_000,
      currency: 'NGN',
      paystackTransactionId: '2',
      whtMinor: 500_000,
    });
    expect(await invoice(invoiceId)).toMatchObject({ status: 'paid', whtCreditedMinor: 500_000 });
    expect(await t.run((ctx) => ctx.db.query('whtCredits').first())).toMatchObject({ status: 'expected' });
  });

  it('refuses a wrong currency, more than is owed, and an unknown invoice', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    const reference = paymentReference(invoiceId, 1);
    await expectCode(
      t.mutation(internal.payments.recordFromPaystack, {
        reference,
        amountMinor: 10_000_000,
        currency: 'USD',
        paystackTransactionId: '3',
        whtMinor: 0,
      }),
      'invoices.invalid',
    );
    await expectCode(
      t.mutation(internal.payments.recordFromPaystack, {
        reference,
        amountMinor: 20_000_000,
        currency: 'NGN',
        paystackTransactionId: '4',
        whtMinor: 0,
      }),
      'invoices.overpaid',
    );
    await expectCode(
      t.mutation(internal.payments.recordFromPaystack, {
        reference: 'inv_notanid_1',
        amountMinor: 100,
        currency: 'NGN',
        paystackTransactionId: '5',
        whtMinor: 0,
      }),
      'invoices.notFound',
    );
  });
});

describe('the pay link', () => {
  it('opens the invoice behind its token, and offers the WHT-reduced amount only where it applies', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await t.mutation(internal.invoices.setPayToken, {
      invoiceId,
      // sha256 of "a-pay-token-value-1234567"
      tokenHash: await (async () => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('a-pay-token-value-1234567'));
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      })(),
    });
    const page = await t.query(internal.invoices.byPayToken, { token: 'a-pay-token-value-1234567' });
    expect(page).toMatchObject({ number: 'UNB-INV-0001', payable: true, whtMinor: 0, balanceMinor: 10_000_000 });
    // NGN is what this Paystack account takes, so the card button shows.
    expect(page.byCard).toBe(true);
    // A currency the account does not take is bank transfer only.
    vi.stubEnv('PAYSTACK_CURRENCIES', 'USD');
    expect((await t.query(internal.invoices.byPayToken, { token: 'a-pay-token-value-1234567' })).byCard).toBe(false);

    await expectCode(
      t.query(internal.invoices.byPayToken, { token: 'made-up-token-value-12345' }),
      'invoices.notFound',
    );
  });
});
