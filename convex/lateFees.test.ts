import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

// Late fees (08-billing-and-finance.md, Late fees). What matters here: nothing is charged until the grace period has
// passed, a fee is raised at most once an invoice a month whether or not it has been sent, it carries no VAT, it is
// charged on the balance still owed and never on an earlier fee, and it can be waived with a reason.

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;
let clientId: Id<'clients'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-23T09:00:00Z'));
  t = newTest();
  roles = await seedRoles(t);
  await t.mutation(internal.seed.run, {});
  clientId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('clients', {
      displayName: 'Glossup',
      kind: 'company',
      status: 'active',
      country: 'NG',
      vatTreatment: 'standard',
      whtApplies: true,
      whtBps: 500,
      defaultCurrency: 'NGN',
      paymentTermsDays: 14,
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

const owner = () => createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio', name: 'Kemi Bello' });

/** The policy the studio is running on, since it starts switched off. */
const enablePolicy = (policy: object = {}) =>
  t.run(async (ctx) => {
    const settings = (await ctx.db.query('orgSettings').first())!;
    await ctx.db.patch('orgSettings', settings._id, {
      lateFeePolicy: { enabled: true, monthlyBps: 500, graceDays: 7, ...policy },
    });
  });

/** A sent invoice of ₦100,000 plus VAT, due 14 days later. */
async function overdueInvoice(as: Awaited<ReturnType<typeof owner>>['as'], memberId: Id<'teamMembers'>) {
  const invoiceId = await as.mutation(api.invoices.create, {
    clientId,
    lineItems: [{ description: 'Design', quantityMilli: 1_000, unitPriceMinor: 100_000_00 }],
  });
  await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId });
  await t.mutation(internal.invoices.markSent, { invoiceId, memberId, recipientContactIds: [] });
  return invoiceId;
}

const lateFees = () =>
  t
    .run((ctx) =>
      ctx.db
        .query('invoices')
        .withIndex('by_status_due', (q) => q.eq('status', 'draft'))
        .collect(),
    )
    .then((rows) => rows.filter((row) => row.type === 'late_fee'));

const invoice = (id: Id<'invoices'>) => t.run((ctx) => ctx.db.get('invoices', id));

describe('late fees', () => {
  it('charges nothing until the due date and the grace period have both passed', async () => {
    const { as, memberId } = await owner();
    await enablePolicy();
    await overdueInvoice(as, memberId);

    // Due 2026-10-07, so nothing on the due date itself.
    vi.setSystemTime(Date.parse('2026-10-07T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 0 });
    // Six days late, one inside the grace period.
    vi.setSystemTime(Date.parse('2026-10-13T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 0 });
    // The seventh day after the due date.
    vi.setSystemTime(Date.parse('2026-10-14T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 1 });
  });

  it('charges the balance owed, with no VAT and nothing to withhold', async () => {
    const { as, memberId } = await owner();
    await enablePolicy();
    const invoiceId = await overdueInvoice(as, memberId);
    const parent = await invoice(invoiceId);
    // ₦100,000 plus 7.5% VAT.
    expect(parent?.balanceMinor).toBe(107_500_00);

    vi.setSystemTime(Date.parse('2026-10-14T09:00:00Z'));
    await t.mutation(internal.lateFees.runDue, {});
    const [fee] = await lateFees();
    expect(fee).toMatchObject({
      type: 'late_fee',
      status: 'draft',
      lateFeeParentInvoiceId: invoiceId,
      vat: { applies: false },
      wht: { applies: false },
    });
    // 5% of the ₦107,500 owed, and the total is that and nothing more.
    expect(fee.totals).toMatchObject({
      subtotalMinor: 5_375_00,
      vatMinor: 0,
      whtExpectedMinor: 0,
      totalMinor: 5_375_00,
    });
    expect(fee.lineItems[0].description).toContain('at 5% a month');

    // Finance is told rather than it going out on its own.
    const notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices.some((notice) => notice.event === 'late_fee_raised')).toBe(true);
  });

  it('charges once a month, whether or not the fee has been sent', async () => {
    const { as, memberId } = await owner();
    await enablePolicy();
    await overdueInvoice(as, memberId);

    vi.setSystemTime(Date.parse('2026-10-14T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 1 });
    // The fee is still a draft with no issue date; running again tomorrow raises nothing.
    vi.setSystemTime(Date.parse('2026-10-15T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 0 });
    vi.setSystemTime(Date.parse('2026-11-13T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 0 });
    // A month after the first fee.
    vi.setSystemTime(Date.parse('2026-11-14T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 1 });
    expect(await lateFees()).toHaveLength(2);
  });

  it('never charges a fee on a fee', async () => {
    const { as, memberId } = await owner();
    await enablePolicy();
    await overdueInvoice(as, memberId);
    vi.setSystemTime(Date.parse('2026-10-14T09:00:00Z'));
    await t.mutation(internal.lateFees.runDue, {});

    // Send the fee so it becomes an open, overdue invoice of its own.
    const [fee] = await lateFees();
    const later = await createTeamMember(t, roles.owner, { email: 'kemi2@unbuilt.studio' });
    await t.mutation(internal.invoices.prepareSend, { invoiceId: fee._id, memberId: later.memberId });
    await t.mutation(internal.invoices.markSent, {
      invoiceId: fee._id,
      memberId: later.memberId,
      recipientContactIds: [],
    });

    vi.setSystemTime(Date.parse('2026-12-20T09:00:00Z'));
    await t.mutation(internal.lateFees.runDue, {});
    const all = await t.run((ctx) => ctx.db.query('invoices').collect());
    // One more fee for the original invoice, and none against the fee itself.
    expect(all.filter((row) => row.lateFeeParentInvoiceId === fee._id)).toHaveLength(0);
  });

  it('stops once the invoice is settled, and leaves clients set to no reminders alone', async () => {
    const { as, memberId } = await owner();
    await enablePolicy();
    const paid = await overdueInvoice(as, memberId);
    vi.setSystemTime(Date.parse('2026-10-08T09:00:00Z'));
    // The clock has moved past the first session, so this needs a fresh one.
    const payer = await createTeamMember(t, roles.owner, { email: 'kemi4@unbuilt.studio' });
    await payer.as.mutation(api.payments.record, {
      invoiceId: paid,
      amountMinor: 107_500_00,
      method: 'bank_transfer',
      receivedOn: '2026-10-08',
    });

    const quiet = await overdueInvoice(payer.as, payer.memberId);
    await t.run(async (ctx) => ctx.db.patch('clients', clientId, { noReminders: true }));

    vi.setSystemTime(Date.parse('2026-10-20T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 0 });
    expect(await invoice(quiet)).toMatchObject({ status: 'sent' });
  });

  it('raises nothing at all while the policy is switched off', async () => {
    const { as, memberId } = await owner();
    await overdueInvoice(as, memberId);
    vi.setSystemTime(Date.parse('2026-11-30T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 0 });
  });

  it('is waived with a reason, and the next month dates from the one before', async () => {
    const { as, memberId } = await owner();
    await enablePolicy();
    await overdueInvoice(as, memberId);
    vi.setSystemTime(Date.parse('2026-10-14T09:00:00Z'));
    await t.mutation(internal.lateFees.runDue, {});
    const [fee] = await lateFees();

    const later = await createTeamMember(t, roles.owner, { email: 'kemi3@unbuilt.studio' });
    await later.as.mutation(api.lateFees.waive, {
      invoiceId: fee._id,
      reason: 'Their bank held the transfer up',
    });
    expect(await invoice(fee._id)).toMatchObject({
      status: 'void',
      voidReason: 'Their bank held the transfer up',
      balanceMinor: 0,
    });

    // A waived fee no longer holds the month open, so the next run charges again.
    vi.setSystemTime(Date.parse('2026-10-15T09:00:00Z'));
    expect(await t.mutation(internal.lateFees.runDue, {})).toEqual({ raised: 1 });
  });

  it('refuses to waive anything that is not a late fee, and needs the permission', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await overdueInvoice(as, memberId);
    await expectCode(as.mutation(api.lateFees.waive, { invoiceId, reason: 'No' }), 'lateFees.notLateFee');

    await enablePolicy();
    vi.setSystemTime(Date.parse('2026-10-14T09:00:00Z'));
    await t.mutation(internal.lateFees.runDue, {});
    const [fee] = await lateFees();
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    await expectCode(pm.as.mutation(api.lateFees.waive, { invoiceId: fee._id, reason: 'Let it go' }), 'auth.forbidden');
  });
});
