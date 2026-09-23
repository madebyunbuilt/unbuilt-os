import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

// Invoices (08-billing-and-finance.md). What matters here: drafts take the client's currency, taxes and terms; totals
// come from the money library; sending numbers once, dates the invoice from its terms and freezes its rate; a sent
// invoice never changes; void only while nothing is paid or credited; and USD or EUR needs a recent rate.

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;
let clientId: Id<'clients'>;
let adaId: Id<'contacts'>;
let bisiId: Id<'contacts'>;

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
  ({ clientId, adaId, bisiId } = await t.run(async (ctx) => {
    const clientId = await ctx.db.insert('clients', {
      displayName: 'Glossup',
      legalName: 'Glossup Limited',
      kind: 'company',
      status: 'active',
      country: 'NG',
      addressLines: ['12 Admiralty Way', 'Lekki'],
      vatTreatment: 'standard',
      whtApplies: true,
      whtBps: 500,
      defaultCurrency: 'NGN',
      paymentTermsDays: 30,
      timezone: 'Africa/Lagos',
      tags: [],
      portalEnabled: false,
    });
    const contact = (name: string, email: string, isPrimary: boolean, isBilling: boolean) =>
      ctx.db.insert('contacts', { clientId, name, email, isPrimary, isBilling, portalAccess: false, status: 'active' });
    return {
      clientId,
      adaId: await contact('Ada Obi', 'ada@glossup.com', true, false),
      bisiId: await contact('Bisi Accounts', 'accounts@glossup.com', false, true),
    };
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

const owner = () => createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio', name: 'Kemi Bello' });

const lines = [
  { description: 'Design', quantityMilli: 1_000, unitPriceMinor: 1_000_000 },
  { description: 'Hosting', quantityMilli: 2_000, unitPriceMinor: 500_000, taxable: false },
];

const invoice = (invoiceId: Id<'invoices'>) => t.run((ctx) => ctx.db.get('invoices', invoiceId));

/** What the send action does around the render, without the render and the email. */
async function sendWithoutEmail(invoiceId: Id<'invoices'>, memberId: Id<'teamMembers'>) {
  const prepared = await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['%PDF-1.7 invoice'], { type: 'application/pdf' })),
  );
  await t.mutation(internal.invoices.attachPdf, { invoiceId, storageId, fileName: `${prepared.number}.pdf`, memberId });
  await t.mutation(internal.invoices.markSent, {
    invoiceId,
    memberId,
    recipientContactIds: prepared.recipients.map((recipient) => recipient.id),
  });
  return prepared;
}

describe('drafting', () => {
  it('takes the client’s currency, taxes and terms, and works the totals out with the money library', async () => {
    const { as } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    const draft = await as.query(api.invoices.get, { invoiceId });

    expect(draft?.number).toBeUndefined();
    expect(draft).toMatchObject({
      status: 'draft',
      currency: 'NGN',
      paymentTermsDays: 30,
      vat: { applies: true, bps: 750 },
      wht: { applies: true, bps: 500 },
    });
    // 10,000 taxable + 10,000 untaxed; VAT 7.5% on the taxable line only; WHT 5% of the net, before VAT.
    expect(draft?.totals).toEqual({
      subtotalMinor: 2_000_000,
      discountMinor: 0,
      taxableMinor: 1_000_000,
      vatMinor: 75_000,
      totalMinor: 2_075_000,
      whtExpectedMinor: 100_000,
    });
    expect(draft?.balanceMinor).toBe(2_075_000);
    expect(draft?.lineItems.map((line) => line.amountMinor)).toEqual([1_000_000, 1_000_000]);
  });

  it('falls back to the studio’s terms, then 14 days', async () => {
    const { as } = await owner();
    await t.run((ctx) => ctx.db.patch('clients', clientId, { paymentTermsDays: undefined }));
    const fourteen = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    expect((await invoice(fourteen))?.paymentTermsDays).toBe(14);

    await t.run(async (ctx) => {
      const settings = (await ctx.db.query('orgSettings').first())!;
      await ctx.db.patch('orgSettings', settings._id, { defaultPaymentTermsDays: 7 });
    });
    const seven = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    expect((await invoice(seven))?.paymentTermsDays).toBe(7);
  });

  it('shares a discount between taxed and untaxed lines, and refuses nonsense', async () => {
    const { as } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, {
      clientId,
      lineItems: lines,
      discount: { kind: 'percent', bps: 1_000 },
    });
    // 10% off 20,000 = 2,000; half of it comes off the taxable line, so VAT is on 9,000.
    expect((await invoice(invoiceId))?.totals).toMatchObject({
      discountMinor: 200_000,
      taxableMinor: 900_000,
      vatMinor: 67_500,
      totalMinor: 1_867_500,
      whtExpectedMinor: 90_000,
    });

    await expectCode(
      as.mutation(api.invoices.create, {
        clientId,
        lineItems: [{ description: 'Design', quantityMilli: 0, unitPriceMinor: 100 }],
      }),
      'invoices.invalid',
    );
    await expectCode(
      as.mutation(api.invoices.create, { clientId, lineItems: lines, discount: { kind: 'percent' } }),
      'invoices.invalid',
    );
  });

  it('edits a draft, and deletes one that was never numbered', async () => {
    const { as } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await as.mutation(api.invoices.update, {
      invoiceId,
      lineItems: [{ description: 'Design', quantityMilli: 1_500, unitPriceMinor: 1_000_000 }],
      paymentTermsDays: 10,
    });
    expect(await invoice(invoiceId)).toMatchObject({ paymentTermsDays: 10, totals: { subtotalMinor: 1_500_000 } });
    await as.mutation(api.invoices.remove, { invoiceId });
    expect(await invoice(invoiceId)).toBeNull();
  });
});

describe('sending', () => {
  it('goes to the billing contacts, or the one chosen, and refuses an empty invoice', async () => {
    const { as } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    expect(await as.mutation(api.invoices.send, { invoiceId })).toEqual({ sendingTo: ['accounts@glossup.com'] });
    expect(await as.mutation(api.invoices.send, { invoiceId, contactIds: [adaId] })).toEqual({
      sendingTo: ['ada@glossup.com'],
    });

    const empty = await as.mutation(api.invoices.create, { clientId, lineItems: [] });
    await expectCode(as.mutation(api.invoices.send, { invoiceId: empty }), 'invoices.empty');
  });

  it('falls back to the primary contact when nobody is marked for billing', async () => {
    const { as } = await owner();
    await t.run((ctx) => ctx.db.patch('contacts', bisiId, { isBilling: false }));
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    expect(await as.mutation(api.invoices.send, { invoiceId })).toEqual({ sendingTo: ['ada@glossup.com'] });
  });

  it('numbers it once, dates it from its terms, and freezes it', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    // A first attempt that failed after numbering: the retry keeps the number.
    const first = await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId });
    const prepared = await sendWithoutEmail(invoiceId, memberId);
    expect(first.number).toBe('UNB-INV-0001');
    expect(prepared.number).toBe('UNB-INV-0001');

    const sent = await invoice(invoiceId);
    expect(sent).toMatchObject({
      status: 'sent',
      issueDate: '2026-09-22',
      dueDate: '2026-10-22',
      recipientContactIds: [bisiId],
    });
    expect(sent?.pdfSha256).toHaveLength(64);
    const file = await t.run((ctx) => ctx.db.get('files', sent!.pdfFileId!));
    expect(file).toMatchObject({ visibility: 'client', owner: { table: 'invoices', id: invoiceId } });

    // The next invoice takes the next number.
    const second = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    expect((await sendWithoutEmail(second, memberId)).number).toBe('UNB-INV-0002');

    // Sent means frozen.
    await expectCode(as.mutation(api.invoices.update, { invoiceId, lineItems: lines }), 'invoices.notDraft');
    await expectCode(as.mutation(api.invoices.send, { invoiceId }), 'invoices.notDraft');
    await expectCode(as.mutation(api.invoices.remove, { invoiceId }), 'invoices.notDraft');
  });

  it('prints the client’s VAT treatment and only the bank accounts in the invoice’s currency', async () => {
    const { as, memberId } = await owner();
    await t.run(async (ctx) => {
      await ctx.db.patch('clients', clientId, { vatTreatment: 'zero_rated' });
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
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    const { pdf } = await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId });
    expect(pdf.vat.applies).toBe(false);
    expect(pdf.vatTreatment).toBe('zero_rated');
    expect(pdf.bankAccounts.map((account) => account.bankName)).toEqual(['GTBank']);
  });
});

describe('foreign exchange', () => {
  it('refuses to send a USD invoice without a rate from the last week, and freezes the latest one', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, { clientId, currency: 'USD', lineItems: lines });
    await expectCode(as.mutation(api.invoices.send, { invoiceId }), 'invoices.staleRate');

    await as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-10', rateToNgnMicro: 1_500_000_000 });
    await expectCode(as.mutation(api.invoices.send, { invoiceId }), 'invoices.staleRate');

    await as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-21', rateToNgnMicro: 1_550_000_000 });
    await sendWithoutEmail(invoiceId, memberId);
    expect((await invoice(invoiceId))?.fxRateToNgnMicro).toBe(1_550_000_000);

    // A later rate never changes what was sent.
    await as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-22', rateToNgnMicro: 1_600_000_000 });
    expect((await invoice(invoiceId))?.fxRateToNgnMicro).toBe(1_550_000_000);
  });

  it('keeps a rate typed on the invoice instead of the latest', async () => {
    const { as, memberId } = await owner();
    await as.mutation(api.fx.setRate, { currency: 'EUR', date: '2026-09-22', rateToNgnMicro: 1_700_000_000 });
    const invoiceId = await as.mutation(api.invoices.create, {
      clientId,
      currency: 'EUR',
      lineItems: lines,
      fxRateToNgnMicro: 1_650_000_000,
    });
    await sendWithoutEmail(invoiceId, memberId);
    expect((await invoice(invoiceId))?.fxRateToNgnMicro).toBe(1_650_000_000);
  });

  it('keeps one rate per day, refuses the future, and says whether the latest is recent', async () => {
    const { as } = await owner();
    await as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-22', rateToNgnMicro: 1_500_000_000 });
    await as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-22', rateToNgnMicro: 1_510_000_000 });
    expect(await as.query(api.fx.history, { currency: 'USD' })).toMatchObject([
      { date: '2026-09-22', rateToNgnMicro: 1_510_000_000 },
    ]);
    await expectCode(
      as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-23', rateToNgnMicro: 1 }),
      'invoices.invalid',
    );
    expect(await as.query(api.fx.current, {})).toMatchObject([
      { currency: 'USD', fresh: true, rateToNgnMicro: 1_510_000_000 },
      { currency: 'EUR', fresh: false },
    ]);
  });
});

describe('void', () => {
  it('voids a sent invoice with nothing paid or credited, keeping its number, and refuses one with money on it', async () => {
    const { as, memberId } = await owner();
    const draftId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await expectCode(as.mutation(api.invoices.voidInvoice, { invoiceId: draftId, reason: 'x' }), 'invoices.notSent');

    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await sendWithoutEmail(invoiceId, memberId);
    await expectCode(as.mutation(api.invoices.voidInvoice, { invoiceId, reason: ' ' }), 'crm.invalid');

    const paidId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await sendWithoutEmail(paidId, memberId);
    await t.run((ctx) => ctx.db.patch('invoices', paidId, { whtCreditedMinor: 100_000, status: 'partially_paid' }));
    await expectCode(as.mutation(api.invoices.voidInvoice, { invoiceId: paidId, reason: 'x' }), 'invoices.hasMoney');
    // A credit note counts as money on it too.
    await t.run((ctx) =>
      ctx.db.patch('invoices', paidId, { whtCreditedMinor: 0, creditedMinor: 50_000, status: 'sent' }),
    );
    await expectCode(as.mutation(api.invoices.voidInvoice, { invoiceId: paidId, reason: 'x' }), 'invoices.hasMoney');
    // And a paid one is closed.
    await t.run((ctx) => ctx.db.patch('invoices', paidId, { status: 'paid' }));
    await expectCode(as.mutation(api.invoices.voidInvoice, { invoiceId: paidId, reason: 'x' }), 'invoices.closed');

    await as.mutation(api.invoices.voidInvoice, { invoiceId, reason: 'Wrong client' });
    expect(await invoice(invoiceId)).toMatchObject({
      status: 'void',
      number: 'UNB-INV-0001',
      voidReason: 'Wrong client',
    });
    await expectCode(as.mutation(api.invoices.remove, { invoiceId }), 'invoices.notDraft');
  });
});

describe('who can do what', () => {
  it('lets Finance do everything, a project manager draft but not send, and a member nothing', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    const invoiceId = await finance.as.mutation(api.invoices.create, { clientId, lineItems: lines });
    expect(await finance.as.mutation(api.invoices.send, { invoiceId })).toBeTruthy();
    await finance.as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-22', rateToNgnMicro: 1_500_000_000 });

    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    const pmDraft = await pm.as.mutation(api.invoices.create, { clientId, lineItems: lines });
    expect(await pm.as.query(api.invoices.list, { status: 'draft' })).toHaveLength(2);
    await expectCode(pm.as.mutation(api.invoices.send, { invoiceId: pmDraft }), 'auth.forbidden');
    await expectCode(
      pm.as.mutation(api.fx.setRate, { currency: 'USD', date: '2026-09-22', rateToNgnMicro: 1 }),
      'auth.forbidden',
    );

    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });
    await expectCode(member.as.query(api.invoices.list, {}), 'auth.forbidden');
    await expectCode(member.as.query(api.invoices.get, { invoiceId }), 'auth.forbidden');
    await expectCode(member.as.mutation(api.invoices.create, { clientId, lineItems: lines }), 'auth.forbidden');
  });
});

describe('sending it again', () => {
  it('emails the stored PDF again, records who got it, and changes nothing about the invoice', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await sendWithoutEmail(invoiceId, memberId);
    const before = await invoice(invoiceId);

    expect(await as.mutation(api.invoices.sendAgain, { invoiceId, contactIds: [adaId] })).toEqual({
      sendingTo: ['ada@glossup.com'],
    });
    await t.mutation(internal.invoices.markSentAgain, {
      invoiceId,
      memberId,
      recipientContactIds: [adaId],
    });

    const after = await invoice(invoiceId);
    // The invoice itself is untouched: the same number, dates, totals, rate and PDF.
    expect(after).toMatchObject({
      number: before!.number,
      issueDate: before!.issueDate,
      dueDate: before!.dueDate,
      totals: before!.totals,
      fxRateToNgnMicro: before!.fxRateToNgnMicro,
      pdfSha256: before!.pdfSha256,
      status: 'sent',
      sentAt: before!.sentAt,
    });
    // Both sends are on the record, and the latest recipients are the ones who just got it.
    expect(after?.sends).toHaveLength(2);
    expect(after?.sends?.map((send) => send.contactIds)).toEqual([[bisiId], [adaId]]);
    expect(after?.recipientContactIds).toEqual([adaId]);
    const activity = await t.run((ctx) => ctx.db.query('activities').collect());
    expect(activity.some((entry) => entry.title === `${before!.number} sent again to Ada Obi`)).toBe(true);
  });

  it('defaults to whoever had it last', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await sendWithoutEmail(invoiceId, memberId);
    expect(await as.mutation(api.invoices.sendAgain, { invoiceId })).toEqual({
      sendingTo: ['accounts@glossup.com'],
    });
  });

  it('refuses a draft, a closed invoice, and one with no stored PDF', async () => {
    const { as, memberId } = await owner();
    const draft = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await expectCode(as.mutation(api.invoices.sendAgain, { invoiceId: draft }), 'invoices.notSent');

    // Numbered by a send whose render failed: there is no PDF to send again.
    await t.mutation(internal.invoices.prepareSend, { invoiceId: draft, memberId });
    await t.mutation(internal.invoices.markSent, { invoiceId: draft, memberId, recipientContactIds: [bisiId] });
    await expectCode(as.mutation(api.invoices.sendAgain, { invoiceId: draft }), 'invoices.noPdf');

    const voided = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await sendWithoutEmail(voided, memberId);
    await as.mutation(api.invoices.voidInvoice, { invoiceId: voided, reason: 'Wrong client' });
    await expectCode(as.mutation(api.invoices.sendAgain, { invoiceId: voided }), 'invoices.closed');
  });

  it('is for the people who send invoices', async () => {
    const { as, memberId } = await owner();
    const invoiceId = await as.mutation(api.invoices.create, { clientId, lineItems: lines });
    await sendWithoutEmail(invoiceId, memberId);
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm2@unbuilt.studio' });
    await expectCode(pm.as.mutation(api.invoices.sendAgain, { invoiceId }), 'auth.forbidden');
  });
});
