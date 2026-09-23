import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

// Money in (08-billing-and-finance.md; decisions of 2026-09-22): payments with WHT, receipts, refunds, WHT disputes,
// credit notes that clear the balance and hold the rest, held credit applied or refunded, and write-offs. Every change
// keeps paid + WHT + credits ≤ total, and the invoice's status follows.

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
  vi.setSystemTime(new Date('2026-09-22T09:00:00+01:00'));
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
      paymentTermsDays: 30,
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
});

const owner = () => createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio' });
const invoice = (id: Id<'invoices'>) => t.run((ctx) => ctx.db.get('invoices', id));

/** A sent invoice for `naira` naira (no VAT unless asked), the way the send action leaves it. */
async function sentInvoice(
  as: Awaited<ReturnType<typeof owner>>['as'],
  memberId: Id<'teamMembers'>,
  naira: number,
  vat = false,
) {
  const invoiceId = await as.mutation(api.invoices.create, {
    clientId,
    lineItems: [{ description: 'Website design', quantityMilli: 1_000, unitPriceMinor: naira * 100 }],
    vat: { applies: vat, bps: 750 },
  });
  await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId });
  await t.mutation(internal.invoices.markSent, { invoiceId, memberId, recipientContactIds: [] });
  return invoiceId;
}

const pay = (as: Awaited<ReturnType<typeof owner>>['as'], invoiceId: Id<'invoices'>, naira: number, whtNaira = 0) =>
  as.mutation(api.payments.record, {
    invoiceId,
    amountMinor: naira * 100,
    whtDeductedMinor: whtNaira * 100,
    receivedOn: '2026-09-22',
    method: 'bank_transfer',
    reference: 'GTB-1',
  });

describe('payments', () => {
  it('settles part and then all of an invoice, numbering a receipt for each payment', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);

    await pay(as, invoiceId, 60_000);
    expect(await invoice(invoiceId)).toMatchObject({
      status: 'partially_paid',
      paidMinor: 6_000_000,
      balanceMinor: 4_000_000,
    });

    await pay(as, invoiceId, 40_000);
    expect(await invoice(invoiceId)).toMatchObject({ status: 'paid', balanceMinor: 0 });
    expect((await invoice(invoiceId))?.paidAt).toBe(Date.now());

    const receipts = await t.run((ctx) => ctx.db.query('receipts').collect());
    expect(receipts.map((receipt) => [receipt.number, receipt.emailed])).toEqual([
      ['UNB-RCT-0001', true],
      ['UNB-RCT-0002', true],
    ]);
    // Nothing more can be paid on it.
    await expectCode(pay(as, invoiceId, 1), 'invoices.notOpen');
  });

  it('counts WHT withheld towards settling it, and refuses more than is owed', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await expectCode(pay(as, invoiceId, 96_000, 5_000), 'invoices.overpaid');

    // The client pays ₦95,000 and withholds ₦5,000 for the tax authority: settled.
    await pay(as, invoiceId, 95_000, 5_000);
    expect(await invoice(invoiceId)).toMatchObject({ status: 'paid', paidMinor: 9_500_000, whtCreditedMinor: 500_000 });
    expect(await as.query(api.payments.whtOutstanding, {})).toMatchObject([
      { amountMinor: 500_000, status: 'expected' },
    ]);
  });

  it('refuses a future date, and a draft or void invoice', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 1_000);
    await expectCode(
      as.mutation(api.payments.record, {
        invoiceId,
        amountMinor: 100,
        receivedOn: '2026-09-23',
        method: 'cash',
      }),
      'invoices.invalid',
    );
    const draftId = await as.mutation(api.invoices.create, {
      clientId,
      lineItems: [{ description: 'x', quantityMilli: 1_000, unitPriceMinor: 100 }],
    });
    await expectCode(pay(as, draftId, 1), 'invoices.notOpen');
  });

  it('reopens the balance when a payment is refunded', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    const paymentId = await pay(as, invoiceId, 100_000);
    await expectCode(
      as.mutation(api.payments.refund, { paymentId, amountMinor: 20_000_000, method: 'bank_transfer', reason: 'x' }),
      'invoices.overRefund',
    );
    await as.mutation(api.payments.refund, {
      paymentId,
      amountMinor: 3_000_000,
      method: 'bank_transfer',
      reason: 'Paid twice by mistake',
    });
    expect(await invoice(invoiceId)).toMatchObject({ status: 'partially_paid', balanceMinor: 3_000_000 });
    expect(await t.run((ctx) => ctx.db.get('payments', paymentId))).toMatchObject({
      status: 'partially_refunded',
      refundedMinor: 3_000_000,
    });
  });
});

describe('what the client is told', () => {
  it('names the WHT certificate and the bank accounts only when they apply', async () => {
    const { as, memberId } = await owner();
    await t.run(async (ctx) => {
      const settings = (await ctx.db.query('orgSettings').first())!;
      await ctx.db.patch('orgSettings', settings._id, {
        bankAccounts: [
          { label: 'Naira', currency: 'NGN', bankName: 'GTBank', accountName: 'Unbuilt', accountNumber: '0123456789' },
          {
            label: 'Dollars',
            currency: 'USD',
            bankName: 'Zenith',
            accountName: 'Unbuilt',
            accountNumber: '9876543210',
          },
        ],
      });
    });
    const plain = await as.mutation(api.invoices.create, {
      clientId,
      lineItems: [{ description: 'Work', quantityMilli: 1_000, unitPriceMinor: 10_000_000 }],
    });
    const quiet = await t.mutation(internal.invoices.prepareSend, { invoiceId: plain, memberId });
    expect(quiet.whtNote).toBeUndefined();
    expect(quiet.bankAccounts.map((account) => account.bankName)).toEqual(['GTBank']);

    const withheld = await as.mutation(api.invoices.create, {
      clientId,
      lineItems: [{ description: 'Work', quantityMilli: 1_000, unitPriceMinor: 10_000_000 }],
      wht: { applies: true, bps: 500 },
    });
    const noted = await t.mutation(internal.invoices.prepareSend, { invoiceId: withheld, memberId });
    expect(noted.whtNote).toBe(
      'If you withhold tax at 5% (₦5,000.00), please pay ₦95,000.00 and send us the WHT certificate.',
    );
  });

  it('tells the client where they stand on a receipt and a credit note', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await pay(as, invoiceId, 60_000, 0);
    const receipt = await t.run((ctx) => ctx.db.query('receipts').first());
    const receiptData = await t.query(internal.financeDocuments.receiptData, { receiptId: receipt!._id });
    expect(receiptData?.summary).toContain('₦60,000.00');
    expect(receiptData?.summary).toContain('₦40,000.00 is still owed on it');

    await as.mutation(api.credits.create, { invoiceId, reason: 'Scope cut', amountMinor: 5_000_000 });
    const note = await t.run((ctx) => ctx.db.query('creditNotes').first());
    const noteData = await t.query(internal.financeDocuments.creditNoteData, { creditNoteId: note!._id });
    expect(noteData?.summary).toContain('Nothing more is owed');
    expect(noteData?.summary).toContain('₦10,000.00 is held as your credit');
  });
});

describe('withholding tax', () => {
  it('records the certificate, and reverses a disputed deduction back onto the balance', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await pay(as, invoiceId, 95_000, 5_000);
    const [credit] = await t.run((ctx) => ctx.db.query('whtCredits').collect());

    await as.mutation(api.payments.markDisputed, { whtCreditId: credit._id, note: 'No certificate after 60 days' });
    expect((await invoice(invoiceId))?.status).toBe('paid');

    await as.mutation(api.payments.reverseWht, { whtCreditId: credit._id, reason: 'Never remitted' });
    expect(await invoice(invoiceId)).toMatchObject({
      status: 'partially_paid',
      whtCreditedMinor: 0,
      balanceMinor: 500_000,
    });
    await expectCode(
      as.mutation(api.payments.markCertificateReceived, { whtCreditId: credit._id }),
      'invoices.reversed',
    );
  });
});

describe('credit notes', () => {
  it('clears what is still owed and holds the rest as client credit (the ₦100k / ₦60k / ₦50k example)', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await pay(as, invoiceId, 60_000);

    await as.mutation(api.credits.create, {
      invoiceId,
      reason: '5 of the 10 days were not delivered',
      amountMinor: 5_000_000,
    });
    expect(await invoice(invoiceId)).toMatchObject({
      status: 'paid',
      paidMinor: 6_000_000,
      creditedMinor: 4_000_000,
      balanceMinor: 0,
    });
    const [note] = await t.run((ctx) => ctx.db.query('creditNotes').collect());
    expect(note).toMatchObject({
      number: 'UNB-CN-0001',
      amountMinor: 5_000_000,
      appliedToInvoiceMinor: 4_000_000,
      heldMinor: 1_000_000,
    });
    expect(await as.query(api.credits.forClient, { clientId })).toMatchObject([
      { currency: 'NGN', remainingMinor: 1_000_000, creditNoteNumber: 'UNB-CN-0001' },
    ]);
  });

  it('never calls a credited invoice paid or partly paid when no money came in', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await as.mutation(api.credits.create, { invoiceId, reason: 'Scope cut', amountMinor: 4_000_000 });
    expect(await invoice(invoiceId)).toMatchObject({ status: 'sent', balanceMinor: 6_000_000 });
    // Cleared entirely by credit: settled, with nothing paid (the screens say "Credited in full").
    await as.mutation(api.credits.create, { invoiceId, reason: 'Cancelled', amountMinor: 6_000_000 });
    expect(await invoice(invoiceId)).toMatchObject({ status: 'paid', paidMinor: 0, balanceMinor: 0 });
  });

  it('reverses VAT in the invoice’s own proportion, and never credits more than the invoice', async () => {
    const { as, memberId } = await owner();
    // ₦100,000 + 7.5% VAT = ₦107,500.
    const invoiceId = await sentInvoice(as, memberId, 100_000, true);
    await as.mutation(api.credits.create, { invoiceId, reason: 'Scope cut', amountMinor: 1_075_000 });
    const [note] = await t.run((ctx) => ctx.db.query('creditNotes').collect());
    expect(note).toMatchObject({ netMinor: 1_000_000, vatMinor: 75_000, amountMinor: 1_075_000 });

    await expectCode(
      as.mutation(api.credits.create, { invoiceId, reason: 'Too much', amountMinor: 10_000_000 }),
      'invoices.overCredit',
    );
  });

  it('credits lines at the invoice’s VAT rate', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000, true);
    await as.mutation(api.credits.create, {
      invoiceId,
      reason: 'Blog dropped',
      lineItems: [{ description: 'Blog', quantityMilli: 1_000, unitPriceMinor: 2_000_000 }],
    });
    const [note] = await t.run((ctx) => ctx.db.query('creditNotes').collect());
    expect(note).toMatchObject({ netMinor: 2_000_000, vatMinor: 150_000, amountMinor: 2_150_000 });
    expect((await invoice(invoiceId))?.balanceMinor).toBe(10_750_000 - 2_150_000);
  });

  it('applies held credit to a later invoice by hand, or refunds it, never across clients or currencies', async () => {
    const { as, memberId } = await owner();
    const first = await sentInvoice(as, memberId, 100_000);
    await pay(as, first, 100_000);
    await as.mutation(api.credits.create, { invoiceId: first, reason: 'Goodwill', amountMinor: 3_000_000 });
    const [credit] = await t.run((ctx) => ctx.db.query('clientCredits').collect());
    expect(credit.remainingMinor).toBe(3_000_000);

    const second = await sentInvoice(as, memberId, 80_000);
    await expectCode(
      as.mutation(api.credits.apply, { clientCreditId: credit._id, invoiceId: second, amountMinor: 4_000_000 }),
      'invoices.overCredit',
    );
    await as.mutation(api.credits.apply, { clientCreditId: credit._id, invoiceId: second, amountMinor: 2_000_000 });
    // Credit corrects rather than pays, so the invoice is still simply sent.
    expect(await invoice(second)).toMatchObject({ status: 'sent', balanceMinor: 6_000_000, creditedMinor: 2_000_000 });

    await as.mutation(api.credits.refund, {
      clientCreditId: credit._id,
      amountMinor: 1_000_000,
      method: 'bank_transfer',
      reason: 'Client asked for it back',
    });
    expect((await t.run((ctx) => ctx.db.get('clientCredits', credit._id)))?.remainingMinor).toBe(0);
    // Refunding held credit changes no invoice.
    expect((await invoice(first))?.status).toBe('paid');
    expect((await t.run((ctx) => ctx.db.query('creditNotes').first()))?.status).toBe('refunded');
  });
});

describe('write-offs', () => {
  it('writes off what is still owed, refuses money until reversed, and reverses back to owed', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await pay(as, invoiceId, 30_000);
    await as.mutation(api.invoices.writeOff, { invoiceId, reason: 'Client closed down' });
    expect(await invoice(invoiceId)).toMatchObject({
      status: 'written_off',
      writtenOffMinor: 7_000_000,
      balanceMinor: 0,
    });
    await expectCode(pay(as, invoiceId, 1), 'invoices.writtenOff');

    await as.mutation(api.invoices.reverseWriteOff, { invoiceId });
    expect(await invoice(invoiceId)).toMatchObject({ status: 'partially_paid', balanceMinor: 7_000_000 });
    await pay(as, invoiceId, 70_000);
    expect((await invoice(invoiceId))?.status).toBe('paid');
  });
});

describe('who can do what', () => {
  it('keeps recording, refunds, credit notes and write-offs to the roles that hold those keys', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await sentInvoice(as, memberId, 100_000);

    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    const paymentId = await pay(finance.as, invoiceId, 10_000);
    await finance.as.mutation(api.credits.create, { invoiceId, reason: 'x', amountMinor: 100_000 });
    await finance.as.mutation(api.payments.refund, { paymentId, amountMinor: 100, method: 'cash', reason: 'x' });

    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    await expectCode(pay(pm.as, invoiceId, 1), 'auth.forbidden');
    await expectCode(
      pm.as.mutation(api.credits.create, { invoiceId, reason: 'x', amountMinor: 100 }),
      'auth.forbidden',
    );
    await expectCode(pm.as.mutation(api.invoices.writeOff, { invoiceId, reason: 'x' }), 'auth.forbidden');

    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });
    await expectCode(member.as.query(api.payments.forInvoice, { invoiceId }), 'auth.forbidden');
    await expectCode(member.as.query(api.credits.forClient, { clientId }), 'auth.forbidden');
  });
});
