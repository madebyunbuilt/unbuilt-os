import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Invoices in the portal (12-client-portal.md, Invoices). What matters here: a client sees their own money and only
// theirs, a draft is never theirs to see, a written-off invoice is not shown at all, and the pay link they are given
// is the one the pay page will actually open.

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
let glossup: Awaited<ReturnType<typeof createClientUser>>;
let qravit: Awaited<ReturnType<typeof createClientUser>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-24T09:00:00Z'));
  vi.stubEnv('PORTAL_URL', 'https://portal.example.com');
  vi.stubEnv('PAY_LINK_SECRET', 'a-pay-link-secret-that-is-at-least-32-chars');
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  finance = await createTeamMember(t, roles.finance, { email: 'funmi@unbuilt.studio', name: 'Funmi Eze' });
  glossup = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  qravit = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A sent invoice for a client, without the email going out. */
async function sentInvoice(clientId: Id<'clients'>, naira = 100_000) {
  const invoiceId = await finance.as.mutation(api.invoices.create, {
    clientId,
    lineItems: [{ description: 'Design', quantityMilli: 1_000, unitPriceMinor: naira * 100 }],
  });
  await t.mutation(internal.invoices.prepareSend, { invoiceId, memberId: finance.memberId });
  await t.mutation(internal.invoices.markSent, {
    invoiceId,
    memberId: finance.memberId,
    recipientContactIds: [],
  });
  return invoiceId;
}

describe('a client’s invoices', () => {
  it('shows their own and never another client’s', async () => {
    const mine = await sentInvoice(glossup.clientId);
    await sentInvoice(qravit.clientId);

    const listed = await glossup.as.query(api.portalBilling.invoices, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: mine, payable: true, balanceMinor: 100_000_00 });
    expect(await qravit.as.query(api.portalBilling.invoices, {})).toHaveLength(1);
  });

  it('never shows a draft', async () => {
    await finance.as.mutation(api.invoices.create, {
      clientId: glossup.clientId,
      lineItems: [{ description: 'Design', quantityMilli: 1_000, unitPriceMinor: 100_000_00 }],
    });
    expect(await glossup.as.query(api.portalBilling.invoices, {})).toEqual([]);
  });

  it('never tells a client their debt was written off', async () => {
    const invoiceId = await sentInvoice(glossup.clientId);
    await finance.as.mutation(api.invoices.writeOff, { invoiceId, reason: 'Gone quiet' });
    expect(await glossup.as.query(api.portalBilling.invoices, {})).toEqual([]);
    expect(await glossup.as.query(api.portalBilling.invoice, { invoiceId })).toBeNull();
  });

  it('does not find another client’s invoice, rather than refusing it', async () => {
    const theirs = await sentInvoice(qravit.clientId);
    expect(await glossup.as.query(api.portalBilling.invoice, { invoiceId: theirs })).toBeNull();
  });

  it('shows what was paid, with the reference the client would recognise', async () => {
    const invoiceId = await sentInvoice(glossup.clientId);
    await t.mutation(internal.payments.recordFromPaystack, {
      reference: `inv_${invoiceId}_1`,
      amountMinor: 40_000_00,
      currency: 'NGN',
      paystackTransactionId: '6585624736',
      paystackChannel: 'card',
      paystackInstrument: 'Card · visa ending 4081',
      whtMinor: 0,
    });

    const read = await glossup.as.query(api.portalBilling.invoice, { invoiceId });
    expect(read).toMatchObject({ balanceMinor: 60_000_00, status: 'partially_paid' });
    expect(read?.payments[0]).toMatchObject({
      amountMinor: 40_000_00,
      method: 'Card · visa ending 4081',
      // Paystack's own id, never the studio's internal inv_<id>_<attempt>.
      reference: '6585624736',
    });
    expect(JSON.stringify(read?.payments)).not.toContain('inv_');
  });
});

describe('paying from the portal', () => {
  it('offers no link at all until the invoice has a pay token', async () => {
    const invoiceId = await sentInvoice(glossup.clientId);
    const { url } = await glossup.as.query(api.portalBilling.payLink, { invoiceId });
    // No token was minted for this invoice, so no link is offered rather than one that would not open.
    expect(url).toBeNull();
  });

  it('offers a link once the invoice has one, and it opens that invoice', async () => {
    const invoiceId = await sentInvoice(glossup.clientId);
    const { deriveToken } = await import('./lib/payLinks');
    const { sha256Hex } = await import('./lib/signatures');
    const token = await deriveToken(invoiceId);
    await t.mutation(internal.invoices.setPayToken, { invoiceId, tokenHash: await sha256Hex(token) });

    const { url } = await glossup.as.query(api.portalBilling.payLink, { invoiceId });
    expect(url).toBe(`https://portal.example.com/pay/${token}`);
    // The page behind it is this invoice, which is the whole point of handing it over.
    expect(await t.query(internal.invoices.byPayToken, { token })).toMatchObject({ payable: true });
  });

  it('gives an invoice that never had a token one, so it can be paid at last', async () => {
    // Sent before PAY_LINK_SECRET existed, so minting returned nothing and no token was ever stored.
    const invoiceId = await sentInvoice(glossup.clientId);
    expect((await glossup.as.query(api.portalBilling.payLink, { invoiceId })).url).toBeNull();
    expect(await t.mutation(internal.invoices.refreshPayTokens, {})).toMatchObject({ refreshed: 1 });
    expect((await glossup.as.query(api.portalBilling.payLink, { invoiceId })).url).toContain('/pay/');
  });

  it('offers a link again once the old random tokens have been brought over', async () => {
    const invoiceId = await sentInvoice(glossup.clientId);
    // An invoice sent before tokens were derived: its stored hash is of something nothing can work out again.
    await t.mutation(internal.invoices.setPayToken, { invoiceId, tokenHash: 'a'.repeat(64) });
    expect((await glossup.as.query(api.portalBilling.payLink, { invoiceId })).url).toBeNull();

    expect(await t.mutation(internal.invoices.refreshPayTokens, {})).toMatchObject({ refreshed: 1 });
    const { url } = await glossup.as.query(api.portalBilling.payLink, { invoiceId });
    expect(url).toContain('/pay/');

    // Running it again changes nothing: the tokens are already the derived ones.
    expect(await t.mutation(internal.invoices.refreshPayTokens, {})).toMatchObject({
      refreshed: 0,
      alreadyDerived: 1,
    });
    const token = url!.slice(url!.lastIndexOf('/') + 1);
    expect(await t.query(internal.invoices.byPayToken, { token })).toMatchObject({ payable: true });
  });

  it('is not open to a client member, who cannot pay', async () => {
    const invoiceId = await sentInvoice(glossup.clientId);
    const member = await createClientUser(t, roles.client_member, {
      clientName: 'unused',
      email: 'junior@glossup.com',
    });
    await t.run(async (ctx) => ctx.db.patch('contacts', member.contactId, { clientId: glossup.clientId }));
    await expectCode(member.as.query(api.portalBilling.payLink, { invoiceId }), 'auth.forbidden');
    // Nor may they read the invoices at all: that is admin-only by default.
    await expectCode(member.as.query(api.portalBilling.invoices, {}), 'auth.forbidden');
  });
});

describe('a client’s statement', () => {
  it('covers their own account, and refuses a range that makes no sense', async () => {
    await sentInvoice(glossup.clientId);
    const statement = await glossup.as.query(api.portalBilling.statement, {
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    // One block per currency the client has moved money in.
    expect(statement[0]).toMatchObject({ currency: 'NGN' });
    expect(statement[0].lines.length).toBeGreaterThan(0);
    await expectCode(
      glossup.as.query(api.portalBilling.statement, { fromDate: '2026-09-30', toDate: '2026-09-01' }),
      'invoices.invalid',
    );
  });

  it('is not open to the studio’s own people', async () => {
    await expectCode(finance.as.query(api.portalBilling.invoices, {}), 'auth.forbidden');
  });
});
