import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, type TestConvex } from './test.auth';

// Expenses (08-billing-and-finance.md, Expenses). What matters here: a member logs and changes only their own, an
// approver decides, and an approved billable expense joins a draft invoice **at cost** unless the studio sets a
// markup — never twice, never across currencies, and never onto an invoice already sent.

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
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let finance: Awaited<ReturnType<typeof createTeamMember>>;
let dayo: Awaited<ReturnType<typeof createTeamMember>>;
let bisi: Awaited<ReturnType<typeof createTeamMember>>;
let clientId: Id<'clients'>;
let projectId: Id<'projects'>;

const STOCK_PHOTO = 25_000_00; // ₦25,000

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-23T09:00:00Z'));
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  vi.stubEnv('FILE_URL_SECRET', 'test-file-url-secret-that-is-long-enough');
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  finance = await createTeamMember(t, roles.finance, { email: 'funmi@unbuilt.studio', name: 'Funmi Eze' });
  dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio', name: 'Dayo Ade' });
  bisi = await createTeamMember(t, roles.member, { email: 'bisi@unbuilt.studio', name: 'Bisi Obi' });
  clientId = await pm.as.mutation(api.clients.create, { displayName: 'Glossup', kind: 'company', tags: [] });
  await pm.as.mutation(api.contacts.create, {
    clientId,
    name: 'Ada Obi',
    email: 'ada@glossup.com',
    isBilling: true,
  });
  projectId = await pm.as.mutation(api.projects.create, {
    clientId,
    name: 'Glossup app',
    type: 'mobile_app',
    billingModel: 'fixed',
    currency: 'NGN',
    startDate: '2026-09-01',
  });
  await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: dayo.memberId });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const logged = async (overrides: object = {}) =>
  await dayo.as.mutation(api.expenses.log, {
    projectId,
    category: 'stock_assets',
    description: 'Licence for three hero images',
    amountMinor: STOCK_PHOTO,
    date: '2026-09-22',
    billable: true,
    ...overrides,
  });

const expense = (id: Id<'expenses'>) => t.run((ctx) => ctx.db.get('expenses', id));
const invoice = (id: Id<'invoices'>) => t.run((ctx) => ctx.db.get('invoices', id));

const approved = async (overrides: object = {}) => {
  const id = await logged(overrides);
  await finance.as.mutation(api.expenses.decide, { expenseId: id, decision: 'approved' });
  return id;
};

const setMarkup = (bps: number) =>
  t.run(async (ctx) => {
    const settings = (await ctx.db.query('orgSettings').first())!;
    await ctx.db.patch('orgSettings', settings._id, { expenseMarkupBps: bps });
  });

describe('logging an expense', () => {
  it('takes the project’s client and the rate on the day it was spent', async () => {
    const id = await logged();
    expect(await expense(id)).toMatchObject({
      projectId,
      clientId,
      status: 'logged',
      currency: 'NGN',
      amountMinor: STOCK_PHOTO,
      fxRateToNgnMicro: 1_000_000,
      billable: true,
      loggedByMemberId: dayo.memberId,
    });
  });

  it('refuses billing a client when there is no project to say which client', async () => {
    // Billable with no project would sit approved for ever and reach no invoice, so it is refused outright.
    await expectCode(logged({ projectId: undefined }), 'expenses.needsProject');
    const own = await logged({ projectId: undefined, billable: false });
    await expectCode(
      dayo.as.mutation(api.expenses.update, {
        expenseId: own,
        category: 'travel',
        description: 'Trip to the south',
        amountMinor: 480_000_00,
        date: '2026-09-22',
        billable: true,
      }),
      'expenses.needsProject',
    );
  });

  it('refuses a future date, an amount of nothing, and a currency with no rate', async () => {
    await expectCode(logged({ date: '2026-09-24' }), 'expenses.future');
    await expectCode(logged({ amountMinor: 0 }), 'expenses.invalid');
    await expectCode(logged({ currency: 'USD' }), 'expenses.noRate');
    await finance.as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-22', rateToNgnMicro: 1_500_000_000 });
    const usd = await logged({ currency: 'USD', amountMinor: 100_00 });
    expect(await expense(usd)).toMatchObject({ currency: 'USD', fxRateToNgnMicro: 1_500_000_000 });
  });

  it('is the member’s own until it is decided', async () => {
    const id = await logged();
    await expectCode(
      bisi.as.mutation(api.expenses.update, {
        expenseId: id,
        category: 'travel',
        description: 'Not mine',
        amountMinor: 1_000_00,
        date: '2026-09-22',
      }),
      'expenses.notYours',
    );
    await dayo.as.mutation(api.expenses.update, {
      expenseId: id,
      projectId,
      category: 'travel',
      description: 'Taxi to the shoot',
      amountMinor: 8_000_00,
      date: '2026-09-22',
      billable: true,
    });
    expect(await expense(id)).toMatchObject({ category: 'travel', amountMinor: 8_000_00 });

    await finance.as.mutation(api.expenses.decide, { expenseId: id, decision: 'approved' });
    await expectCode(
      dayo.as.mutation(api.expenses.update, {
        expenseId: id,
        category: 'travel',
        description: 'Changed my mind',
        amountMinor: 9_000_00,
        date: '2026-09-22',
      }),
      'expenses.decided',
    );
    await expectCode(dayo.as.mutation(api.expenses.remove, { expenseId: id }), 'expenses.decided');
  });
});

describe('deciding', () => {
  it('approves, and tells the member', async () => {
    const id = await logged();
    await finance.as.mutation(api.expenses.decide, { expenseId: id, decision: 'approved' });
    expect(await expense(id)).toMatchObject({ status: 'approved', approvedBy: finance.memberId });
    const notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices.some((notice) => notice.recipientId === dayo.memberId && notice.event === 'expense_approved')).toBe(
      true,
    );
  });

  it('needs a note to turn one down, and decides only once', async () => {
    const id = await logged();
    await expectCode(
      finance.as.mutation(api.expenses.decide, { expenseId: id, decision: 'rejected' }),
      'expenses.needsNote',
    );
    await finance.as.mutation(api.expenses.decide, {
      expenseId: id,
      decision: 'rejected',
      note: 'Buy this through the studio account',
    });
    expect(await expense(id)).toMatchObject({
      status: 'rejected',
      decisionNote: 'Buy this through the studio account',
    });
    await expectCode(
      finance.as.mutation(api.expenses.decide, { expenseId: id, decision: 'approved' }),
      'expenses.decided',
    );
  });

  it('is not the logger’s own to do', async () => {
    const id = await logged();
    await expectCode(dayo.as.mutation(api.expenses.decide, { expenseId: id, decision: 'approved' }), 'auth.forbidden');
  });

  it('pays a reimbursable expense back only once approved', async () => {
    const notOwed = await approved();
    await expectCode(
      finance.as.mutation(api.expenses.markReimbursed, { expenseId: notOwed }),
      'expenses.notReimbursable',
    );
    const owed = await logged({ reimbursable: true });
    await expectCode(finance.as.mutation(api.expenses.markReimbursed, { expenseId: owed }), 'expenses.notApproved');
    await finance.as.mutation(api.expenses.decide, { expenseId: owed, decision: 'approved' });
    await finance.as.mutation(api.expenses.markReimbursed, { expenseId: owed });
    expect(await expense(owed)).toMatchObject({ status: 'reimbursed', reimbursedAt: Date.now() });
  });
});

describe('putting it on an invoice', () => {
  const draftInvoice = () =>
    finance.as.mutation(api.invoices.create, {
      clientId,
      projectId,
      lineItems: [{ description: 'Design', quantityMilli: 1_000, unitPriceMinor: 500_000_00 }],
    });

  it('recharges what the studio paid, and takes the expense out of the queue', async () => {
    const expenseId = await approved();
    const invoiceId = await draftInvoice();
    expect(await finance.as.query(api.expenses.billableFor, { clientId, currency: 'NGN' })).toMatchObject([
      { id: expenseId, rechargeMinor: STOCK_PHOTO },
    ]);

    await finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [expenseId] });
    const raised = await invoice(invoiceId);
    expect(raised?.lineItems).toHaveLength(2);
    expect(raised?.lineItems[1]).toMatchObject({ amountMinor: STOCK_PHOTO, quantityMilli: 1_000 });
    expect(raised?.lineItems[1].description).toBe('Stock and assets: Licence for three hero images (2026-09-22)');
    // ₦500,000 of work plus the ₦25,000 recharged, and the totals worked out again.
    expect(raised?.totals.subtotalMinor).toBe(525_000_00);
    expect(raised?.balanceMinor).toBe(raised?.totals.totalMinor);

    expect(await expense(expenseId)).toMatchObject({ status: 'invoiced', invoiceId });
    expect(await finance.as.query(api.expenses.billableFor, { clientId, currency: 'NGN' })).toEqual([]);
  });

  it('adds the studio’s markup when it has set one', async () => {
    await setMarkup(1_000); // 10%
    const expenseId = await approved();
    const invoiceId = await draftInvoice();
    expect(await finance.as.query(api.expenses.billableFor, { clientId, currency: 'NGN' })).toMatchObject([
      { rechargeMinor: 27_500_00 },
    ]);
    await finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [expenseId] });
    expect((await invoice(invoiceId))?.lineItems[1]).toMatchObject({ amountMinor: 27_500_00 });
  });

  it('refuses one twice, one not billable, one not approved, and the wrong currency', async () => {
    const expenseId = await approved();
    const invoiceId = await draftInvoice();
    await finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [expenseId] });
    await expectCode(
      finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [expenseId] }),
      'expenses.invoiced',
    );

    const internalSpend = await approved({ billable: false });
    await expectCode(
      finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [internalSpend] }),
      'expenses.notBillable',
    );

    const waiting = await logged();
    await expectCode(
      finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [waiting] }),
      'expenses.notApproved',
    );

    await finance.as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-22', rateToNgnMicro: 1_500_000_000 });
    const inDollars = await approved({ currency: 'USD', amountMinor: 100_00 });
    await expectCode(
      finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [inDollars] }),
      'expenses.currency',
    );

    // An expense with no project belongs to no client, so it reaches nobody's invoice even if asked for directly.
    const clientless = await t.run(async (ctx) => {
      const id = await ctx.db.insert('expenses', {
        category: 'travel',
        description: 'Trip to the south',
        amountMinor: 480_000_00,
        currency: 'NGN',
        fxRateToNgnMicro: 1_000_000,
        date: '2026-09-22',
        billable: true,
        reimbursable: true,
        status: 'approved',
        loggedByMemberId: dayo.memberId,
      });
      return id;
    });
    await expectCode(
      finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [clientless] }),
      'expenses.noClient',
    );
  });

  it('never touches an invoice that has been sent', async () => {
    const expenseId = await approved();
    const invoiceId = await draftInvoice();
    await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId: finance.memberId });
    await t.mutation(internal.invoices.markSent, {
      invoiceId,
      memberId: finance.memberId,
      recipientContactIds: [],
    });
    await expectCode(
      finance.as.mutation(api.expenses.addToInvoice, { invoiceId, expenseIds: [expenseId] }),
      'expenses.invoiceSent',
    );
  });
});

describe('who sees what', () => {
  it('shows a member only their own, and an approver everything', async () => {
    const mine = await logged();
    await bisi.as.mutation(api.expenses.log, {
      category: 'software',
      description: 'A font licence',
      amountMinor: 15_000_00,
      date: '2026-09-21',
    });

    expect((await dayo.as.query(api.expenses.list, {})).map((row) => row.id)).toEqual([mine]);
    expect(await finance.as.query(api.expenses.list, {})).toHaveLength(2);
    // Someone else's expense is not found rather than refused: nothing says it exists.
    const theirs = (await finance.as.query(api.expenses.list, {})).find((row) => row.id !== mine)!;
    await expectCode(dayo.as.query(api.expenses.get, { expenseId: theirs.id }), 'projects.notFound');
  });
});
