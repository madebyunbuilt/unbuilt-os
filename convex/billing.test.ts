import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

// Chasing and statements (08-billing-and-finance.md; decisions of 2026-09-22): the daily run marks overdue and sends
// each reminder once, respecting "no reminders"; statements add up, per currency, and never show a write-off.

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;
let clientId: Id<'clients'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T09:00:00+01:00'));
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

let signIns = 0;
const owner = () => createTeamMember(t, roles.owner, { email: `owner${++signIns}@unbuilt.studio` });
/** A fresh sign-in after the clock jumps weeks ahead, since the old session would have timed out. */
const again = async () => (await owner()).as;
const invoice = (id: Id<'invoices'>) => t.run((ctx) => ctx.db.get('invoices', id));
const at = (date: string) => vi.setSystemTime(new Date(`${date}T09:00:00+01:00`));

async function sentInvoice(
  as: Awaited<ReturnType<typeof owner>>['as'],
  memberId: Id<'teamMembers'>,
  naira: number,
  currency: 'NGN' | 'USD' = 'NGN',
) {
  const invoiceId = await as.mutation(api.invoices.create, {
    clientId,
    currency,
    lineItems: [{ description: 'Work', quantityMilli: 1_000, unitPriceMinor: naira * 100 }],
    ...(currency === 'USD' ? { fxRateToNgnMicro: 1_500_000_000 } : {}),
  });
  await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId });
  await t.mutation(internal.invoices.markSent, { invoiceId, memberId, recipientContactIds: [] });
  return invoiceId;
}

describe('the daily run', () => {
  it('marks an unpaid invoice overdue after its due date, and sends each reminder once', async () => {
    const signedIn = await owner();
    const { memberId } = signedIn;
    let { as } = signedIn;
    // Sent 1 September on 30 days: due 1 October.
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    expect((await invoice(invoiceId))?.dueDate).toBe('2026-10-01');

    at('2026-09-28');

    as = await again();
    expect(await t.mutation(internal.billingChase.dailyRun, {})).toEqual({ overdue: 0, reminders: 1 });
    expect(await t.mutation(internal.billingChase.dailyRun, {})).toEqual({ overdue: 0, reminders: 0 });

    at('2026-10-02');

    as = await again();
    expect(await t.mutation(internal.billingChase.dailyRun, {})).toEqual({ overdue: 1, reminders: 1 });
    expect(await invoice(invoiceId)).toMatchObject({ status: 'overdue' });
    expect((await invoice(invoiceId))?.reminders.map((reminder) => reminder.kind)).toEqual(['before_3', 'due']);
  });

  it('calls a partly paid invoice overdue once it is past due', async () => {
    const signedIn = await owner();
    const { memberId } = signedIn;
    let { as } = signedIn;
    const invoiceId = await sentInvoice(as, memberId, 100_000);
    await as.mutation(api.payments.record, {
      invoiceId,
      amountMinor: 3_000_000,
      receivedOn: '2026-09-01',
      method: 'bank_transfer',
      emailReceipt: false,
    });
    expect((await invoice(invoiceId))?.status).toBe('partially_paid');
    at('2026-10-05');
    as = await again();
    await t.mutation(internal.billingChase.dailyRun, {});
    expect(await invoice(invoiceId)).toMatchObject({ status: 'overdue', paidMinor: 3_000_000 });
    // A payment after the due date keeps it overdue while money is still owed.
    await as.mutation(api.payments.record, {
      invoiceId,
      amountMinor: 1_000_000,
      receivedOn: '2026-10-05',
      method: 'bank_transfer',
      emailReceipt: false,
    });
    expect((await invoice(invoiceId))?.status).toBe('overdue');
  });

  it('sends nothing for an invoice or client with reminders off, or once it is paid', async () => {
    const signedIn = await owner();
    const { memberId } = signedIn;
    let { as } = signedIn;
    const quiet = await sentInvoice(as, memberId, 1_000);
    await as.mutation(api.billingChase.setInvoiceReminders, { invoiceId: quiet, off: true });
    const paid = await sentInvoice(as, memberId, 1_000);
    await as.mutation(api.payments.record, {
      invoiceId: paid,
      amountMinor: 100_000,
      receivedOn: '2026-09-01',
      method: 'cash',
      emailReceipt: false,
    });
    at('2026-10-01');
    as = await again();
    expect((await t.mutation(internal.billingChase.dailyRun, {})).reminders).toBe(0);

    const other = await t.run(async (ctx) => {
      await ctx.db.patch('invoices', quiet, { noReminders: false });
      return quiet;
    });
    await as.mutation(api.billingChase.setClientReminders, { clientId, off: true });
    at('2026-10-04');
    as = await again();
    expect((await t.mutation(internal.billingChase.dailyRun, {})).reminders).toBe(0);
    void other;
  });
});

describe('statements', () => {
  it('adds up: opening balance, each line with a running balance, and the closing balance', async () => {
    const signedIn = await owner();
    const { memberId } = signedIn;
    let { as } = signedIn;
    const first = await sentInvoice(as, memberId, 100_000); // 1 September
    at('2026-09-10');
    as = await again();
    await as.mutation(api.payments.record, {
      invoiceId: first,
      amountMinor: 6_000_000,
      receivedOn: '2026-09-10',
      method: 'bank_transfer',
      reference: 'GTB-1',
      emailReceipt: false,
    });
    at('2026-09-15');
    as = await again();
    await as.mutation(api.credits.create, { invoiceId: first, reason: 'Scope cut', amountMinor: 5_000_000 });
    at('2026-10-01');
    as = await again();
    await sentInvoice(as, memberId, 80_000);

    const [ngn] = await as.query(api.statements.forClient, { clientId, fromDate: '2026-09-12', toDate: '2026-10-31' });
    // Before the 12th: ₦100,000 invoiced, ₦60,000 paid.
    expect(ngn.openingMinor).toBe(4_000_000);
    expect(ngn.lines.map((line) => [line.date, line.kind, line.balanceMinor])).toEqual([
      ['2026-09-15', 'credit_note', -1_000_000],
      ['2026-10-01', 'invoice', 7_000_000],
    ]);
    // ₦80,000 owed on the second invoice, less the ₦10,000 held from the credit note.
    expect(ngn.closingMinor).toBe(7_000_000);
  });

  it('keeps currencies apart, and leaves void and written-off invoices off entirely', async () => {
    const first = await owner();
    const { memberId } = first;
    const { as } = first;
    await as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-01', rateToNgnMicro: 1_500_000_000 });
    await sentInvoice(as, memberId, 500, 'USD');
    const voided = await sentInvoice(as, memberId, 10_000);
    await as.mutation(api.invoices.voidInvoice, { invoiceId: voided, reason: 'Wrong client' });
    const gone = await sentInvoice(as, memberId, 20_000);
    await as.mutation(api.payments.record, {
      invoiceId: gone,
      amountMinor: 500_000,
      receivedOn: '2026-09-01',
      method: 'cash',
      emailReceipt: false,
    });
    await as.mutation(api.invoices.writeOff, { invoiceId: gone, reason: 'Closed down' });
    const kept = await sentInvoice(as, memberId, 30_000);
    void kept;

    const sections = await as.query(api.statements.forClient, {
      clientId,
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    expect(sections.map((section) => [section.currency, section.closingMinor])).toEqual([
      ['NGN', 3_000_000],
      ['USD', 50_000],
    ]);
    const ngn = sections.find((section) => section.currency === 'NGN')!;
    expect(ngn.lines.map((line) => line.description).join(' ')).not.toMatch(/written|UNB-INV-0002|UNB-INV-0003/i);
  });

  it('asks for the PDF, kept on the statement, to invoices.view holders only', async () => {
    const { as } = await owner();
    const statementId = await as.mutation(api.statements.requestPdf, {
      clientId,
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    expect(await as.query(api.statements.listPdfs, { clientId })).toMatchObject([
      { id: statementId, status: 'rendering' },
    ]);
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });
    await expect(
      member.as.query(api.statements.forClient, { clientId, fromDate: '2026-09-01', toDate: '2026-09-30' }),
    ).rejects.toThrow();
  });
});
