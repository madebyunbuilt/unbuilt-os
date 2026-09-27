import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { nextYear } from './lib/assets';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Managed assets and renewals (09-support-and-sla.md). A domain that lapses takes a client's site with it, so what
// matters here is that somebody is told in time, once per threshold, and that a transferred asset goes quiet.

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
let admin: Awaited<ReturnType<typeof createTeamMember>>;
let ada: Awaited<ReturnType<typeof createClientUser>>;
let clientId: Id<'clients'>;

/** Moves the clock, keeping everybody signed in: these tests cross months. */
async function travelTo(iso: string) {
  vi.setSystemTime(Date.parse(`${iso}T09:00:00Z`));
  const now = Date.now();
  await t.run(async (ctx) => {
    for (const { sessionId, authUserId } of [pm, admin, ada]) {
      const row = await ctx.db
        .query('sessionActivity')
        .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
        .unique();
      if (row) await ctx.db.patch('sessionActivity', row._id, { lastActiveAt: now });
      else await ctx.db.insert('sessionActivity', { sessionId, authUserId, lastActiveAt: now });
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: 'session',
          where: [{ field: '_id', value: sessionId }],
          update: { expiresAt: now + 7 * 24 * 60 * 60 * 1000, updatedAt: now },
        },
      });
    }
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-01T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  admin = await createTeamMember(t, roles.admin, { email: 'chidi@unbuilt.studio', name: 'Chidi Eze' });
  ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  clientId = ada.clientId;
});

afterEach(() => {
  vi.useRealTimers();
});

const newAsset = async (overrides: object = {}) =>
  await pm.as.mutation(api.assets.create, {
    clientId,
    type: 'domain',
    name: 'glossup.com',
    provider: 'Namecheap',
    renewsOnDate: '2026-12-01',
    costMinor: 15_00,
    costCurrency: 'USD',
    billPriceMinor: 30_000_00,
    billCurrency: 'NGN',
    autoInvoice: false,
    ...overrides,
  });

const remind = async () => await t.mutation(internal.assets.remindRenewals, {});
const reminders = async () =>
  (await t.run((ctx) => ctx.db.query('notifications').collect())).filter((n) => n.event === 'asset.renewal');
const sentThresholds = async (assetId: Id<'managedAssets'>) =>
  (await t.run((ctx) => ctx.db.get('managedAssets', assetId)))!.remindersSent;

describe('when somebody is told', () => {
  it('says nothing until the first threshold', async () => {
    const assetId = await newAsset();
    // Sixty-one days out.
    await travelTo('2026-10-01');
    expect(await remind()).toEqual({ reminded: 0, drafted: 0 });
    expect(await reminders()).toEqual([]);
    expect(await sentThresholds(assetId)).toEqual([]);
  });

  it('fires each threshold once, and never again', async () => {
    const assetId = await newAsset();
    for (const [day, threshold] of [
      ['2026-10-02', 60],
      ['2026-11-01', 30],
      ['2026-11-17', 14],
      ['2026-11-24', 7],
    ] as const) {
      await travelTo(day);
      expect(await remind(), day).toMatchObject({ reminded: 1 });
      expect(await sentThresholds(assetId)).toContain(threshold);
      // Running again the same day, or the next, says nothing more.
      expect(await remind(), `${day} again`).toMatchObject({ reminded: 0 });
    }
    expect(await sentThresholds(assetId)).toEqual([60, 30, 14, 7]);
  });

  it('still tells somebody about a threshold that was missed', async () => {
    const assetId = await newAsset();
    // Nobody looked until eight days out: the sixty, thirty and fourteen day marks all went by.
    await travelTo('2026-11-23');
    expect(await remind()).toMatchObject({ reminded: 1 });
    expect(await sentThresholds(assetId)).toEqual([60, 30, 14]);
    // One message, not four: the point is that somebody knows, not that a calendar was kept.
    expect(new Set((await reminders()).map((n) => n.title)).size).toBe(1);
  });

  it('tells the client from thirty days out, and not before', async () => {
    await newAsset();
    await travelTo('2026-10-02');
    await remind();
    expect((await reminders()).filter((n) => n.recipientKind === 'client')).toEqual([]);

    await travelTo('2026-11-01');
    await remind();
    const told = (await reminders()).filter((n) => n.recipientKind === 'client');
    expect(told.map((n) => n.recipientId)).toContain(ada.contactId);
  });

  it('says nothing at all about an asset handed to the client', async () => {
    const assetId = await newAsset();
    await pm.as.mutation(api.assets.close, { assetId, status: 'transferred' });
    await travelTo('2026-11-24');
    expect(await remind()).toEqual({ reminded: 0, drafted: 0 });
    expect(await reminders()).toEqual([]);
  });
});

describe('the invoice it raises', () => {
  it('drafts one at thirty days when the studio asked it to, once', async () => {
    const assetId = await newAsset({ autoInvoice: true });
    await travelTo('2026-10-02');
    // At sixty days it is too early to invoice.
    expect(await remind()).toMatchObject({ drafted: 0 });

    await travelTo('2026-11-01');
    expect(await remind()).toMatchObject({ drafted: 1 });
    const invoices = await t.run((ctx) => ctx.db.query('invoices').collect());
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: 'draft', clientId, createdByMemberId: pm.memberId });
    expect(invoices[0].lineItems[0].description).toContain('glossup.com renewal (Namecheap)');
    // What the client pays, not what it cost the studio.
    expect(invoices[0].lineItems[0].amountMinor).toBe(30_000_00);

    await travelTo('2026-11-17');
    expect(await remind()).toMatchObject({ drafted: 0 });
    expect(await t.run((ctx) => ctx.db.query('invoices').collect())).toHaveLength(1);
    expect((await pm.as.query(api.assets.get, { assetId }))!.renewalInvoiceId).toBe(invoices[0]._id);
  });

  it('drafts nothing when the studio does not bill it on', async () => {
    await newAsset({ autoInvoice: false });
    await travelTo('2026-11-01');
    expect(await remind()).toMatchObject({ drafted: 0 });
    expect(await t.run((ctx) => ctx.db.query('invoices').collect())).toEqual([]);
  });

  it('refuses to invoice automatically with no price to invoice', async () => {
    await expectCode(
      newAsset({ autoInvoice: true, billPriceMinor: undefined, billCurrency: undefined }),
      'assets.invalid',
    );
  });

  it('refuses half a price', async () => {
    await expectCode(newAsset({ billCurrency: undefined }), 'assets.invalid');
  });
});

describe('renewing it', () => {
  it('starts the next renewal clean', async () => {
    const assetId = await newAsset({ autoInvoice: true });
    await travelTo('2026-11-01');
    await remind();
    expect(await sentThresholds(assetId)).toEqual([60, 30]);

    await pm.as.mutation(api.assets.markRenewed, { assetId, nextRenewsOnDate: '2027-12-01' });
    const asset = (await pm.as.query(api.assets.get, { assetId }))!;
    expect(asset.renewsOnDate).toBe('2027-12-01');
    expect(asset.remindersSent).toEqual([]);
    // A new renewal drafts its own invoice when the time comes, rather than pointing at last year's.
    expect(asset.renewalInvoiceId).toBeUndefined();
  });

  it('will not accept a date that is not after this one', async () => {
    const assetId = await newAsset();
    await expectCode(
      pm.as.mutation(api.assets.markRenewed, { assetId, nextRenewsOnDate: '2026-11-01' }),
      'assets.invalid',
    );
  });

  it('suggests a year on, and handles the 29th of February', async () => {
    expect(nextYear('2026-12-01')).toBe('2027-12-01');
    // 2028 is a leap year, 2029 is not: the 29th renews on the 28th rather than slipping into March.
    expect(nextYear('2028-02-29')).toBe('2029-02-28');
  });

  it('forgets what was said when the date is moved by hand', async () => {
    const assetId = await newAsset();
    await travelTo('2026-11-01');
    await remind();
    await pm.as.mutation(api.assets.update, {
      assetId,
      type: 'domain',
      name: 'glossup.com',
      provider: 'Namecheap',
      renewsOnDate: '2027-03-01',
      costMinor: 15_00,
      costCurrency: 'USD',
      billPriceMinor: 30_000_00,
      billCurrency: 'NGN',
      autoInvoice: false,
    });
    // A moved date is a different renewal, so it is told about from scratch.
    expect(await sentThresholds(assetId)).toEqual([]);
  });
});

describe('when it has already lapsed', () => {
  it('tells the admins, once a day, until somebody says it was renewed', async () => {
    const assetId = await newAsset();
    await travelTo('2026-12-03');
    expect(await t.mutation(internal.assets.alertOverdue, {})).toEqual({ overdue: 1 });
    // Not twice in one day.
    expect(await t.mutation(internal.assets.alertOverdue, {})).toEqual({ overdue: 0 });

    const told = (await t.run((ctx) => ctx.db.query('notifications').collect())).filter(
      (n) => n.event === 'asset.overdue',
    );
    expect(told.map((n) => n.recipientId)).toContain(admin.memberId);
    expect(told[0].title).toContain('should have been renewed on 2026-12-01');

    // The next day it says so again, because it gets worse.
    await travelTo('2026-12-04');
    expect(await t.mutation(internal.assets.alertOverdue, {})).toEqual({ overdue: 1 });

    await pm.as.mutation(api.assets.markRenewed, { assetId, nextRenewsOnDate: '2027-12-01' });
    await travelTo('2026-12-05');
    expect(await t.mutation(internal.assets.alertOverdue, {})).toEqual({ overdue: 0 });
  });

  it('leaves a transferred asset alone', async () => {
    const assetId = await newAsset();
    await pm.as.mutation(api.assets.close, { assetId, status: 'transferred' });
    await travelTo('2026-12-03');
    expect(await t.mutation(internal.assets.alertOverdue, {})).toEqual({ overdue: 0 });
  });
});

describe('who may keep assets', () => {
  it('is closed to a role without assets.manage', async () => {
    const assetId = await newAsset();
    const finance = await createTeamMember(t, roles.finance, { email: 'zainab@unbuilt.studio', name: 'Zainab B' });
    await expectCode(finance.as.query(api.assets.list, {}), 'auth.forbidden');
    await expectCode(finance.as.query(api.assets.get, { assetId }), 'auth.forbidden');
    await expectCode(
      finance.as.mutation(api.assets.markRenewed, { assetId, nextRenewsOnDate: '2027-12-01' }),
      'auth.forbidden',
    );
    await expectCode(finance.as.mutation(api.assets.close, { assetId, status: 'cancelled' }), 'auth.forbidden');
  });
});
