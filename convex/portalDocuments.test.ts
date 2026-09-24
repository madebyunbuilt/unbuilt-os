import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Documents in the portal (12-client-portal.md, Documents). What matters here: a client reads only what was actually
// sent to their own company, a quote is accepted by somebody entitled to commit them, and the decision is recorded
// against the contact who made it rather than against the studio.

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
let admin: Awaited<ReturnType<typeof createClientUser>>;
let other: Awaited<ReturnType<typeof createClientUser>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-24T09:00:00Z'));
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  vi.stubEnv('FILE_URL_SECRET', 'test-file-url-secret-that-is-long-enough');
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  admin = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  other = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A quote for a client, sent the way the studio sends one, without the email going out. */
async function sentQuote(clientId: Id<'clients'>, recipientContactIds: Id<'contacts'>[] = []) {
  const documentId = await pm.as.mutation(api.documents.create, {
    type: 'quote',
    clientId,
    title: 'Mobile app build',
    lineItems: [{ description: 'Design and build', quantityMilli: 1_000, unitPriceMinor: 1_000_000_00 }],
  });
  // What a real send needs filled in before it will go: the wording has no gaps left.
  await pm.as.mutation(api.documents.setPaymentSchedule, {
    documentId,
    paymentScheduleSummary: '50% on signature, 50% on completion',
  });
  // The wording asks for the reader's job title, and a send is addressed to the client's own default contact.
  await t.run(async (ctx) => {
    const contacts = await ctx.db
      .query('contacts')
      .withIndex('by_client', (q) => q.eq('clientId', clientId))
      .collect();
    for (const contact of contacts) await ctx.db.patch('contacts', contact._id, { jobTitle: 'Director' });
  });
  const prepared = await t.mutation(internal.documents.prepareSend, { documentId, memberId: pm.memberId });
  await t.mutation(internal.documents.markSent, {
    documentId,
    version: prepared.version,
    emailed: [],
    recipientContactIds,
  });
  return documentId;
}

/** A second contact at a client, who is a member rather than an admin. */
async function memberAt(clientId: Id<'clients'>, email: string) {
  const user = await createClientUser(t, roles.client_member, { clientName: 'unused', email });
  // Move them onto the client that matters, as a colleague of the admin.
  await t.run(async (ctx) => {
    await ctx.db.patch('contacts', user.contactId, { clientId });
  });
  return user;
}

describe('what a client can read', () => {
  it('lists what was sent to their own company, and never another’s', async () => {
    await sentQuote(admin.clientId);
    await sentQuote(other.clientId);

    const mine = await admin.as.query(api.portalDocuments.list, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ typeLabel: 'Quote', status: 'sent', asks: 'decision' });
    expect(await other.as.query(api.portalDocuments.list, {})).toHaveLength(1);
  });

  it('never shows a draft, even to the client it is being written for', async () => {
    const draft = await pm.as.mutation(api.documents.create, {
      type: 'quote',
      clientId: admin.clientId,
      title: 'Still being written',
    });
    expect(await admin.as.query(api.portalDocuments.list, {})).toEqual([]);
    expect(await admin.as.query(api.portalDocuments.get, { documentId: draft })).toBeNull();
  });

  it('does not find another client’s document, rather than refusing it', async () => {
    const theirs = await sentQuote(other.clientId);
    expect(await admin.as.query(api.portalDocuments.get, { documentId: theirs })).toBeNull();
  });

  it('reads the wording with its variables filled in', async () => {
    const documentId = await sentQuote(admin.clientId);
    const read = await admin.as.query(api.portalDocuments.get, { documentId });
    expect(read).toMatchObject({ title: 'Mobile app build', canDecide: true });
    expect(JSON.stringify(read?.blocks)).not.toContain('{{client.name}}');
    expect(JSON.stringify(read?.blocks)).toContain('Glossup');
  });
});

describe('accepting a quote', () => {
  it('records the contact who accepted it, not the studio', async () => {
    const documentId = await sentQuote(admin.clientId);
    expect(await admin.as.mutation(api.portalDocuments.decide, { documentId, decision: 'accepted' })).toEqual({
      status: 'accepted',
    });

    const document = await t.run((ctx) => ctx.db.get('documents', documentId));
    expect(document).toMatchObject({
      status: 'accepted',
      acceptedAt: Date.now(),
      acceptedByContactId: admin.contactId,
      decidedVersion: 1,
    });
    // The studio did not record this one, so nothing says a member did.
    expect(document?.decisionRecordedByMemberId).toBeUndefined();
    const activity = await t.run((ctx) => ctx.db.query('activities').collect());
    expect(activity.some((entry) => entry.title.includes('accepted by'))).toBe(true);
  });

  it('needs a reason to decline, and decides only once', async () => {
    const documentId = await sentQuote(admin.clientId);
    await expectCode(
      admin.as.mutation(api.portalDocuments.decide, { documentId, decision: 'declined' }),
      'documents.needsReason',
    );
    await admin.as.mutation(api.portalDocuments.decide, {
      documentId,
      decision: 'declined',
      note: 'Going another way for now',
    });
    expect(await t.run((ctx) => ctx.db.get('documents', documentId))).toMatchObject({
      status: 'declined',
      declinedReason: 'Going another way for now',
    });
    await expectCode(
      admin.as.mutation(api.portalDocuments.decide, { documentId, decision: 'accepted' }),
      'documents.decided',
    );
  });

  it('lets a member accept only what the studio addressed to them', async () => {
    const member = await memberAt(admin.clientId, 'junior@glossup.com');
    const addressedToTheAdmin = await sentQuote(admin.clientId, [admin.contactId]);
    expect(await member.as.query(api.portalDocuments.get, { documentId: addressedToTheAdmin })).toMatchObject({
      canDecide: false,
    });
    await expectCode(
      member.as.mutation(api.portalDocuments.decide, { documentId: addressedToTheAdmin, decision: 'accepted' }),
      'documents.notYours',
    );

    const addressedToThem = await sentQuote(admin.clientId, [member.contactId]);
    expect(await member.as.query(api.portalDocuments.get, { documentId: addressedToThem })).toMatchObject({
      canDecide: true,
    });
    await member.as.mutation(api.portalDocuments.decide, { documentId: addressedToThem, decision: 'accepted' });
    expect(await t.run((ctx) => ctx.db.get('documents', addressedToThem))).toMatchObject({
      acceptedByContactId: member.contactId,
    });
  });

  it('lets an admin accept whatever was sent to their company', async () => {
    const documentId = await sentQuote(admin.clientId, []);
    expect(await admin.as.query(api.portalDocuments.get, { documentId })).toMatchObject({ canDecide: true });
  });

  it('refuses to accept something that is signed rather than accepted', async () => {
    const documentId = await pm.as.mutation(api.documents.create, {
      type: 'contract',
      clientId: admin.clientId,
      title: 'Build agreement',
    });
    await t.run(async (ctx) => ctx.db.patch('documents', documentId, { status: 'sent' }));
    await expectCode(
      admin.as.mutation(api.portalDocuments.decide, { documentId, decision: 'accepted' }),
      'documents.notAccepted',
    );
  });

  it('is not open to the studio’s own people', async () => {
    const documentId = await sentQuote(admin.clientId);
    await expectCode(pm.as.query(api.portalDocuments.list, {}), 'auth.forbidden');
    await expectCode(
      pm.as.mutation(api.portalDocuments.decide, { documentId, decision: 'accepted' }),
      'auth.forbidden',
    );
  });
});
