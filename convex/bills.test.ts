import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, type TestConvex } from './test.auth';

// Vendors and bills (08-billing-and-finance.md, Vendors and bills). What matters here: bank details reach only the
// people who pay, a bill goes draft → approved → scheduled → paid, and paying one withholds the tax the studio owes on
// the vendor's behalf — on the amount before the vendor's VAT — and keeps the deduction for remittance.

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let finance: Awaited<ReturnType<typeof createTeamMember>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let dayo: Awaited<ReturnType<typeof createTeamMember>>;
let vendorId: Id<'vendors'>;

// ₦1,075,000 with ₦75,000 of VAT: ₦1,000,000 of work.
const BILL = 1_075_000_00;
const VAT = 75_000_00;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-23T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  finance = await createTeamMember(t, roles.finance, { email: 'funmi@unbuilt.studio', name: 'Funmi Eze' });
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio', name: 'Dayo Ade' });
  vendorId = await finance.as.mutation(api.vendors.create, {
    name: 'Chidi Animation',
    kind: 'contractor',
    email: 'chidi@example.com',
    bankDetails: { bankName: 'GTBank', accountName: 'Chidi Animation Ltd', accountNumber: '0123456789' },
    tin: '12345678-0001',
    // 5% withheld on a contractor's fee.
    whtBps: 500,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const newBill = async (overrides: object = {}) =>
  await finance.as.mutation(api.bills.create, {
    vendorId,
    reference: 'CA-2026-14',
    description: 'Title sequence animation',
    amountMinor: BILL,
    vatMinor: VAT,
    issueDate: '2026-09-01',
    dueDate: '2026-09-30',
    ...overrides,
  });

const bill = (id: Id<'bills'>) => t.run((ctx) => ctx.db.get('bills', id));

describe('vendors', () => {
  it('keeps bank details to the people who pay, and redacts them in the audit log', async () => {
    const seen = await finance.as.query(api.vendors.get, { vendorId });
    expect(seen).toMatchObject({
      name: 'Chidi Animation',
      whtBps: 500,
      hasBankDetails: true,
      bankDetails: { bankName: 'GTBank', accountNumber: '0123456789' },
    });

    // A project manager keeps vendors but does not pay them; they still need the details to set one up.
    await expectCode(dayo.as.query(api.vendors.list, {}), 'auth.forbidden');

    const entries = await t.run((ctx) => ctx.db.query('auditLog').collect());
    const created = entries.find((entry) => entry.table === 'vendors');
    expect(JSON.stringify(created)).not.toContain('0123456789');
    expect(JSON.stringify(created)).toContain('[redacted]');
  });

  it('refuses an impossible withholding rate', async () => {
    await expectCode(
      finance.as.mutation(api.vendors.create, { name: 'Odd', kind: 'supplier', whtBps: 12_000 }),
      'bills.invalid',
    );
  });

  it('archives rather than deletes, and refuses new bills for an archived vendor', async () => {
    await finance.as.mutation(api.vendors.setStatus, { vendorId, status: 'archived' });
    expect(await finance.as.query(api.vendors.list, {})).toEqual([]);
    expect(await finance.as.query(api.vendors.list, { includeArchived: true })).toHaveLength(1);
    await expectCode(newBill(), 'bills.archived');
  });
});

describe('bills', () => {
  it('goes draft, approved, scheduled, paid', async () => {
    const billId = await newBill();
    expect(await finance.as.query(api.bills.get, { billId })).toMatchObject({
      status: 'draft',
      vendorName: 'Chidi Animation',
      amountMinor: BILL,
      vatMinor: VAT,
      // Before it is paid the screen already shows what would be withheld: 5% of the ₦1,000,000 before VAT.
      whtMinor: 50_000_00,
      payableMinor: 1_025_000_00,
    });

    await expectCode(
      finance.as.mutation(api.bills.schedule, { billId, scheduledFor: '2026-09-29' }),
      'bills.notApproved',
    );
    await expectCode(finance.as.mutation(api.bills.pay, { billId, paidOn: '2026-09-23' }), 'bills.notApproved');

    await finance.as.mutation(api.bills.approve, { billId });
    await finance.as.mutation(api.bills.schedule, { billId, scheduledFor: '2026-09-29' });
    expect(await bill(billId)).toMatchObject({ status: 'scheduled', scheduledFor: '2026-09-29' });

    const paid = await finance.as.mutation(api.bills.pay, {
      billId,
      paidOn: '2026-09-23',
      paymentReference: 'GTB/TRF/88213',
    });
    expect(paid).toEqual({ whtMinor: 50_000_00, payableMinor: 1_025_000_00 });
    expect(await bill(billId)).toMatchObject({
      status: 'paid',
      whtMinor: 50_000_00,
      paidMinor: 1_025_000_00,
      paidOn: '2026-09-23',
      paymentReference: 'GTB/TRF/88213',
      paidByMemberId: finance.memberId,
    });
    await expectCode(finance.as.mutation(api.bills.pay, { billId, paidOn: '2026-09-23' }), 'bills.paid');
  });

  it('withholds nothing for a vendor with no rate, and takes an override on the day', async () => {
    const supplierId = await finance.as.mutation(api.vendors.create, { name: 'Paper Co', kind: 'supplier' });
    const plain = await newBill({ vendorId: supplierId, amountMinor: 50_000_00, vatMinor: 0 });
    await finance.as.mutation(api.bills.approve, { billId: plain });
    expect(await finance.as.mutation(api.bills.pay, { billId: plain, paidOn: '2026-09-23' })).toEqual({
      whtMinor: 0,
      payableMinor: 50_000_00,
    });

    const special = await newBill();
    await finance.as.mutation(api.bills.approve, { billId: special });
    // 10% on this one bill, whatever the vendor's usual rate.
    expect(
      await finance.as.mutation(api.bills.pay, { billId: special, paidOn: '2026-09-23', whtBpsOverride: 1_000 }),
    ).toEqual({ whtMinor: 100_000_00, payableMinor: 975_000_00 });
  });

  it('refuses amounts and dates that make no sense', async () => {
    await expectCode(newBill({ amountMinor: 0 }), 'bills.invalid');
    await expectCode(newBill({ vatMinor: BILL + 1 }), 'bills.invalid');
    await expectCode(newBill({ issueDate: '2026-09-30', dueDate: '2026-09-01' }), 'bills.invalid');
    await expectCode(newBill({ currency: 'USD' }), 'bills.noRate');

    const billId = await newBill();
    await finance.as.mutation(api.bills.approve, { billId });
    await expectCode(finance.as.mutation(api.bills.pay, { billId, paidOn: '2026-09-24' }), 'bills.future');
  });

  it('stops changing once it is paid, and a voided bill is never paid', async () => {
    const billId = await newBill();
    await finance.as.mutation(api.bills.approve, { billId });
    await finance.as.mutation(api.bills.pay, { billId, paidOn: '2026-09-23' });
    await expectCode(
      finance.as.mutation(api.bills.update, {
        billId,
        vendorId,
        reference: 'CA-2026-14',
        description: 'Changed',
        amountMinor: BILL,
        issueDate: '2026-09-01',
        dueDate: '2026-09-30',
      }),
      'bills.closed',
    );
    await expectCode(finance.as.mutation(api.bills.voidBill, { billId, reason: 'Too late' }), 'bills.paid');

    const cancelled = await newBill({ reference: 'CA-2026-15' });
    await finance.as.mutation(api.bills.voidBill, { billId: cancelled, reason: 'Sent to the wrong studio' });
    await expectCode(
      finance.as.mutation(api.bills.pay, { billId: cancelled, paidOn: '2026-09-23' }),
      'bills.notApproved',
    );
    // A draft can be deleted outright; anything approved stays on record.
    const draft = await newBill({ reference: 'CA-2026-16' });
    await finance.as.mutation(api.bills.remove, { billId: draft });
    await finance.as.mutation(api.bills.approve, { billId: await newBill({ reference: 'CA-2026-17' }) });
    const approvedId = (await finance.as.query(api.bills.list, { status: 'approved' }))[0].id;
    await expectCode(finance.as.mutation(api.bills.remove, { billId: approvedId }), 'bills.closed');
  });
});

describe('what the studio owes the tax authority', () => {
  it('adds up what was withheld from vendors in the range, per currency', async () => {
    const first = await newBill();
    await finance.as.mutation(api.bills.approve, { billId: first });
    await finance.as.mutation(api.bills.pay, { billId: first, paidOn: '2026-09-10' });

    const second = await newBill({ reference: 'CA-2026-20', amountMinor: 215_000_00, vatMinor: 15_000_00 });
    await finance.as.mutation(api.bills.approve, { billId: second });
    await finance.as.mutation(api.bills.pay, { billId: second, paidOn: '2026-09-20' });

    // Outside the range.
    const third = await newBill({ reference: 'CA-2026-21' });
    await finance.as.mutation(api.bills.approve, { billId: third });
    await finance.as.mutation(api.bills.pay, { billId: third, paidOn: '2026-08-30' });

    const report = await finance.as.query(api.bills.whtToRemit, { from: '2026-09-01', to: '2026-09-30' });
    expect(report.lines).toHaveLength(2);
    expect(report.lines[0]).toMatchObject({ paidOn: '2026-09-10', whtMinor: 50_000_00, vendorTin: '12345678-0001' });
    // ₦50,000 plus 5% of the ₦200,000 before VAT.
    expect(report.byCurrency).toEqual({ NGN: 60_000_00 });
  });
});

describe('telling the people who pay', () => {
  it('names the bills due this week and the ones already late', async () => {
    const soon = await newBill({ dueDate: '2026-09-27' });
    await finance.as.mutation(api.bills.approve, { billId: soon });
    expect(await t.mutation(internal.bills.remindDue, {})).toEqual({ due: 1, overdue: 0 });
    const notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices[0]).toMatchObject({ event: 'bills_due', recipientId: finance.memberId });
    expect(notices[0].title).toContain('due within 7 days');

    const late = await newBill({ reference: 'CA-2026-30', dueDate: '2026-09-20' });
    await finance.as.mutation(api.bills.approve, { billId: late });
    expect(await t.mutation(internal.bills.remindDue, {})).toEqual({ due: 1, overdue: 1 });
  });

  it('says nothing when there is nothing waiting', async () => {
    await newBill({ dueDate: '2026-12-31' });
    expect(await t.mutation(internal.bills.remindDue, {})).toEqual({ due: 0, overdue: 0 });
    expect(await t.run((ctx) => ctx.db.query('notifications').collect())).toEqual([]);
  });
});

describe('who can do what', () => {
  it('keeps vendors and bills to Finance', async () => {
    await expectCode(pm.as.query(api.bills.list, {}), 'auth.forbidden');
    await expectCode(pm.as.mutation(api.vendors.create, { name: 'Nope', kind: 'supplier' }), 'auth.forbidden');
    await expectCode(dayo.as.query(api.vendors.get, { vendorId }), 'auth.forbidden');
  });
});
