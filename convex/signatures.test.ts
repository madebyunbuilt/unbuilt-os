import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { DAY_MS, sha256Hex } from './lib/signatures';
import { createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

// E-signatures (07-documents-and-esign.md, E-signatures). What matters here: a link works only for its signer, only
// after their code, and never once the request has closed; five wrong codes lock it; sequential order holds; declining
// and expiry hand the document back; and the evidence recorded is what the certificate needs.

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;
let clientId: Id<'clients'>;
let adaId: Id<'contacts'>;
let bayoId: Id<'contacts'>;

const FROM = { ip: '203.0.113.7', userAgent: 'Vitest' };

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
  ({ clientId, adaId, bayoId } = await t.run(async (ctx) => {
    const clientId = await ctx.db.insert('clients', {
      displayName: 'Glossup',
      legalName: 'Glossup Limited',
      kind: 'company',
      status: 'active',
      country: 'NG',
      addressLines: ['12 Admiralty Way', 'Lekki'],
      vatTreatment: 'standard',
      whtApplies: false,
      defaultCurrency: 'NGN',
      timezone: 'Africa/Lagos',
      tags: [],
      portalEnabled: false,
    });
    const contact = (name: string, email: string, isPrimary: boolean) =>
      ctx.db.insert('contacts', {
        clientId,
        name,
        email,
        isPrimary,
        isBilling: isPrimary,
        portalAccess: false,
        status: 'active',
      });
    return {
      clientId,
      adaId: await contact('Ada Obi', 'ada@glossup.com', true),
      bayoId: await contact('Bayo Ade', 'bayo@glossup.com', false),
    };
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

/** A contract sent the way the send action leaves it: numbered, with a stored PDF and its hash. */
async function sentContract(memberId: Id<'teamMembers'>, as: Awaited<ReturnType<typeof createTeamMember>>['as']) {
  const documentId = await as.mutation(api.documents.create, { type: 'contract', clientId });
  // Nothing may be missing from what goes out: the contract names the studio and prints the payment schedule.
  await t.run(async (ctx) => {
    await ctx.db.patch('documents', documentId, { paymentScheduleSummary: '50% on signature, 50% on completion' });
    const settings = (await ctx.db.query('orgSettings').first())!;
    await ctx.db.patch('orgSettings', settings._id, { legalName: 'Unbuilt Studio Ltd', addressLines: ['Lagos'] });
  });
  const prepared = await t.mutation(internal.documents.prepareSend, { documentId, memberId });
  const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(['%PDF-1.7 the contract'])));
  await t.mutation(internal.documents.attachPdf, {
    documentId,
    version: prepared.version,
    storageId,
    fileName: `${prepared.number}.pdf`,
    memberId,
  });
  await t.mutation(internal.documents.markSent, { documentId, version: prepared.version, emailed: [] });
  return documentId;
}

async function owner() {
  return await createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio', name: 'Kemi Bello' });
}

const request = (requestId: Id<'signatureRequests'>) => t.run((ctx) => ctx.db.get('signatureRequests', requestId));
const signer = async (requestId: Id<'signatureRequests'>, id: string) =>
  (await request(requestId))!.signers.find((candidate) => candidate.id === id)!;

/** What the link email would carry: a token whose hash is stored against the signer. */
async function linkFor(requestId: Id<'signatureRequests'>, signerId: string) {
  const token = `token-${requestId}-${signerId}-${Math.random().toString(36).slice(2)}`;
  const link = await t.mutation(internal.signatures.setLink, {
    requestId,
    signerId,
    tokenHash: await sha256Hex(token),
  });
  expect(link).not.toBeNull();
  return token;
}

/** The code the signer would find in their inbox. */
async function verified(token: string) {
  const { code } = await t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip });
  const result = await t.mutation(internal.signatures.verifyCode, { token, code, ...FROM });
  expect(result.ok).toBe(true);
}

async function signTyped(token: string, name: string) {
  return await t.mutation(internal.signatures.signByToken, {
    token,
    method: 'typed',
    typedName: name,
    consent: true,
    ...FROM,
  });
}

describe('setting up a request', () => {
  it('locks the sent version and its hash, and invites only the first client in sequential order', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, {
      documentId,
      contactIds: [adaId, bayoId],
      countersignerMemberId: memberId,
    });

    const created = await request(requestId);
    const document = await t.run((ctx) => ctx.db.get('documents', documentId));
    expect(created).toMatchObject({ status: 'pending', order: 'sequential', documentVersion: 1 });
    expect(created?.pdfSha256).toBe(document?.pdfSha256);
    expect(created?.expiresAt).toBe(Date.now() + 14 * DAY_MS);
    expect(created?.signers.map((s) => [s.id, s.kind, s.status])).toEqual([
      ['c1', 'client_contact', 'invited'],
      ['c2', 'client_contact', 'waiting'],
      ['s1', 'team_member', 'waiting'],
    ]);
    expect(document?.status).toBe('awaiting_signature');
  });

  it('invites every client at once in parallel order', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, {
      documentId,
      contactIds: [adaId, bayoId],
      order: 'parallel',
    });
    expect((await request(requestId))?.signers.map((s) => s.status)).toEqual(['invited', 'invited']);
  });

  it('refuses a draft, a quote, a second open request, and a contact from another client', async () => {
    const { as, memberId } = await owner();
    const draftId = await as.mutation(api.documents.create, { type: 'contract', clientId });
    await expectCode(
      as.mutation(api.signatures.createRequest, { documentId: draftId, contactIds: [adaId] }),
      'documents.notSendable',
    );

    const quoteId = await as.mutation(api.documents.create, {
      type: 'quote',
      clientId,
      lineItems: [{ description: 'Design', quantityMilli: 1_000, unitPriceMinor: 100_000 }],
    });
    await expectCode(
      as.mutation(api.signatures.createRequest, { documentId: quoteId, contactIds: [adaId] }),
      'signatures.notSigned',
    );

    const documentId = await sentContract(memberId, as);
    const strangerId = await t.run(async (ctx) => {
      const otherClient = await ctx.db.insert('clients', {
        displayName: 'Other',
        kind: 'company',
        status: 'active',
        country: 'NG',
        vatTreatment: 'standard',
        whtApplies: false,
        defaultCurrency: 'NGN',
        timezone: 'Africa/Lagos',
        tags: [],
        portalEnabled: false,
      });
      return await ctx.db.insert('contacts', {
        clientId: otherClient,
        name: 'Stranger',
        email: 'stranger@other.com',
        isPrimary: true,
        isBilling: true,
        portalAccess: false,
        status: 'active',
      });
    });
    await expectCode(
      as.mutation(api.signatures.createRequest, { documentId, contactIds: [strangerId] }),
      'signatures.invalid',
    );

    await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    await expectCode(as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] }), 'signatures.open');
  });

  it('refuses a countersigner whose role cannot countersign', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    await expectCode(
      as.mutation(api.signatures.createRequest, {
        documentId,
        contactIds: [adaId],
        countersignerMemberId: pm.memberId,
      }),
      'signatures.invalid',
    );
  });

  it('stops a re-send while signing is under way, since the new version would not match', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    await expectCode(as.mutation(api.documents.send, { documentId }), 'documents.signing');
  });
});

describe('the signing link', () => {
  it('does nothing without a real token, and shows the document only while it is the signer’s to sign', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId, bayoId] });

    await expectCode(
      t.query(internal.signatures.viewByToken, { token: 'made-up-token-value-123' }),
      'signatures.notFound',
    );

    const ada = await linkFor(requestId, 'c1');
    const page = await t.query(internal.signatures.viewByToken, { token: ada });
    expect(page.document?.pdfSha256).toBe((await request(requestId))?.pdfSha256);
    expect(page.consent?.text).toContain('legal equivalent of my handwritten signature');

    // Bayo has not been invited yet: no link is minted for a signer still waiting.
    expect(
      await t.mutation(internal.signatures.setLink, { requestId, signerId: 'c2', tokenHash: await sha256Hex('x') }),
    ).toBeNull();
  });

  it('records the signer opening it as the client viewing the document', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const token = await linkFor(requestId, 'c1');
    await t.mutation(internal.signatures.markViewed, { token, ...FROM });

    expect((await signer(requestId, 'c1')).viewedAt).toBe(Date.now());
    const views = await t.run((ctx) => ctx.db.query('documentViews').collect());
    expect(views).toMatchObject([{ viewerKind: 'token', viewerId: adaId, ip: FROM.ip }]);
  });

  it('replaces the old link when a new one is sent', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const first = await linkFor(requestId, 'c1');
    const second = await linkFor(requestId, 'c1');
    await expectCode(t.query(internal.signatures.viewByToken, { token: first }), 'signatures.notFound');
    expect((await t.query(internal.signatures.viewByToken, { token: second })).document).not.toBeNull();
  });
});

describe('the emailed code', () => {
  it('must be checked before signing or declining', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const token = await linkFor(requestId, 'c1');

    await expectCode(signTyped(token, 'Ada Obi'), 'signatures.codeNeeded');
    await expectCode(
      t.mutation(internal.signatures.declineByToken, { token, reason: 'No', ...FROM }),
      'signatures.codeNeeded',
    );
  });

  it('is stored only as a hash and stops working after ten minutes', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const token = await linkFor(requestId, 'c1');

    const { code } = await t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip });
    expect(code).toMatch(/^\d{6}$/);
    const stored = await signer(requestId, 'c1');
    expect(stored.codeHash).toBe(await sha256Hex(code));
    expect(JSON.stringify(stored)).not.toContain(`"${code}"`);

    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    await expectCode(t.mutation(internal.signatures.verifyCode, { token, code, ...FROM }), 'signatures.codeExpired');
  });

  it('locks the link after five wrong tries across codes, until the studio sends a new one', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const token = await linkFor(requestId, 'c1');

    const { code } = await t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip });
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) {
      expect(await t.mutation(internal.signatures.verifyCode, { token, code: wrong, ...FROM })).toMatchObject({
        ok: false,
      });
    }
    // A fresh code does not buy more guesses.
    const { code: fresh } = await t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip });
    const wrongAgain = fresh === '000000' ? '111111' : '000000';
    expect(await t.mutation(internal.signatures.verifyCode, { token, code: wrongAgain, ...FROM })).toMatchObject({
      ok: false,
      attemptsLeft: 1,
    });
    expect(await t.mutation(internal.signatures.verifyCode, { token, code: wrongAgain, ...FROM })).toMatchObject({
      ok: false,
      locked: true,
    });

    expect((await signer(requestId, 'c1')).status).toBe('locked');
    await expectCode(t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip }), 'signatures.locked');
    const notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices.some((n) => n.event === 'signing_locked' && n.recipientId === memberId)).toBe(true);

    // The studio sends a new link: the tries start again, and the signer can go on.
    await as.mutation(api.signatures.resendLink, { requestId, signerId: 'c1' });
    expect(await signer(requestId, 'c1')).toMatchObject({ status: 'invited', codeAttempts: 0 });
    const next = await linkFor(requestId, 'c1');
    await verified(next);
  });

  it('limits how many codes a link can ask for', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const token = await linkFor(requestId, 'c1');
    for (let i = 0; i < 5; i++) await t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip });
    await expectCode(t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip }), 'signatures.rateLimited');
  });
});

describe('signing', () => {
  it('records the evidence, then invites the next signer, then the studio countersigns in the app', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, {
      documentId,
      contactIds: [adaId, bayoId],
      countersignerMemberId: memberId,
    });

    const ada = await linkFor(requestId, 'c1');
    await verified(ada);
    expect(await signTyped(ada, 'Ada Obi')).toEqual({ ok: true });

    const evidence = await t.run((ctx) => ctx.db.query('signatures').collect());
    const locked = await request(requestId);
    expect(evidence).toMatchObject([
      {
        signerId: 'c1',
        method: 'typed',
        typedName: 'Ada Obi',
        consentVersion: 1,
        ip: FROM.ip,
        userAgent: FROM.userAgent,
        verification: 'email_code',
        documentSha256: locked?.pdfSha256,
        signedAt: Date.now(),
      },
    ]);
    expect(evidence[0].consentText).toContain('legal equivalent');
    expect(locked?.signers.map((s) => s.status)).toEqual(['signed', 'invited', 'waiting']);
    expect((await t.run((ctx) => ctx.db.get('documents', documentId)))?.status).toBe('partially_signed');

    // Signing twice is refused.
    await expectCode(signTyped(ada, 'Ada Obi'), 'signatures.alreadySigned');
    // The countersigner cannot jump the queue.
    await expectCode(
      as.mutation(api.signatures.countersign, { requestId, typedName: 'Kemi Bello', consent: true }),
      'signatures.notYet',
    );

    const bayo = await linkFor(requestId, 'c2');
    await verified(bayo);
    await signTyped(bayo, 'Bayo Ade');
    expect((await signer(requestId, 's1')).status).toBe('invited');
    const notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices.some((n) => n.event === 'countersign_needed' && n.recipientId === memberId)).toBe(true);

    await as.mutation(api.signatures.countersign, { requestId, typedName: 'Kemi Bello', consent: true });
    const done = await request(requestId);
    expect(done).toMatchObject({ status: 'completed', completedAt: Date.now() });
    const countersigned = (await t.run((ctx) => ctx.db.query('signatures').collect())).find((s) => s.signerId === 's1');
    expect(countersigned).toMatchObject({ verification: 'app_session', typedName: 'Kemi Bello' });
    expect(await t.run((ctx) => ctx.db.get('documents', documentId))).toMatchObject({
      status: 'signed',
      signedAt: Date.now(),
    });

    // Everything the certificate lists is there, in order.
    const data = await t.query(internal.signatures.completionData, { requestId });
    expect(data?.signers.map((s) => [s.name, s.method, s.verification])).toEqual([
      ['Ada Obi', 'typed', 'email_code'],
      ['Bayo Ade', 'typed', 'email_code'],
      ['Kemi Bello', 'typed', 'app_session'],
    ]);
    expect(data?.certificate.documentSha256).toBe(done?.pdfSha256);

    // A signed document stays signed: no void, no re-send.
    await expectCode(as.mutation(api.documents.voidDocument, { documentId, reason: 'x' }), 'documents.signed');
    // The link says what happened, without the document.
    const after = await t.query(internal.signatures.viewByToken, { token: ada });
    expect(after).toMatchObject({ document: null, request: { status: 'completed' }, signer: { status: 'signed' } });
  });

  it('needs consent and a name', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const token = await linkFor(requestId, 'c1');
    await verified(token);
    await expectCode(
      t.mutation(internal.signatures.signByToken, {
        token,
        method: 'typed',
        typedName: 'Ada',
        consent: false,
        ...FROM,
      }),
      'signatures.consent',
    );
    await expectCode(
      t.mutation(internal.signatures.signByToken, { token, method: 'typed', typedName: '  ', consent: true, ...FROM }),
      'signatures.invalid',
    );
    await expectCode(
      t.mutation(internal.signatures.signByToken, {
        token,
        method: 'drawn',
        imageStorageId: 'nonsense',
        consent: true,
        ...FROM,
      }),
      'signatures.invalid',
    );
  });

  it('keeps a countersignature to the member named on the request', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, {
      documentId,
      contactIds: [adaId],
      countersignerMemberId: memberId,
      order: 'parallel',
    });
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    await expectCode(
      admin.as.mutation(api.signatures.countersign, { requestId, typedName: 'Admin', consent: true }),
      'signatures.notYours',
    );
  });
});

describe('declining, cancelling and expiry', () => {
  it('ends the request on a decline, with the reason, and tells whoever set it up', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, {
      documentId,
      contactIds: [adaId, bayoId],
      order: 'parallel',
    });
    const ada = await linkFor(requestId, 'c1');
    const bayo = await linkFor(requestId, 'c2');
    await verified(ada);
    await t.mutation(internal.signatures.declineByToken, { token: ada, reason: 'The fees are wrong', ...FROM });

    expect(await request(requestId)).toMatchObject({ status: 'declined' });
    expect(await t.run((ctx) => ctx.db.get('documents', documentId))).toMatchObject({
      status: 'declined',
      declinedReason: 'The fees are wrong',
    });
    const notices = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notices.some((n) => n.event === 'signing_declined' && n.body === 'The fees are wrong')).toBe(true);
    // Nobody else can act on it now.
    await expectCode(t.mutation(internal.signatures.issueCode, { token: bayo, ip: FROM.ip }), 'signatures.closed');
  });

  it('cancels with a reason and hands the contract back, ready for a new request', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const token = await linkFor(requestId, 'c1');
    await expectCode(as.mutation(api.signatures.cancelRequest, { requestId, reason: ' ' }), 'crm.invalid');
    await as.mutation(api.signatures.cancelRequest, { requestId, reason: 'Wrong signer' });

    expect(await request(requestId)).toMatchObject({ status: 'cancelled' });
    expect((await t.run((ctx) => ctx.db.get('documents', documentId)))?.status).toBe('awaiting_signature');
    await expectCode(t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip }), 'signatures.closed');
    await as.mutation(api.signatures.createRequest, { documentId, contactIds: [bayoId] });
  });

  it('closes the request when the document is voided', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    await as.mutation(api.documents.voidDocument, { documentId, reason: 'Superseded' });
    expect(await request(requestId)).toMatchObject({ status: 'cancelled' });
  });

  it('expires on its date, after which the link does nothing', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, {
      documentId,
      contactIds: [adaId],
      expiresInDays: 2,
    });
    const token = await linkFor(requestId, 'c1');

    vi.setSystemTime(Date.now() + 2 * DAY_MS);
    // Refused on time even before the hourly job has run.
    await expectCode(t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip }), 'signatures.expired');
    expect(await t.mutation(internal.signatures.expireRequests, {})).toEqual({ expired: 1 });
    expect(await request(requestId)).toMatchObject({ status: 'expired' });
    expect((await t.run((ctx) => ctx.db.get('documents', documentId)))?.status).toBe('awaiting_signature');
  });
});

describe('reminders', () => {
  it('reminds a pending signer on day 3, day 7 and the day before expiry, once each', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const start = Date.now();

    expect(await t.mutation(internal.signatures.sendReminders, {})).toEqual({ sent: 0 });
    vi.setSystemTime(start + 3 * DAY_MS);
    expect(await t.mutation(internal.signatures.sendReminders, {})).toEqual({ sent: 1 });
    expect(await t.mutation(internal.signatures.sendReminders, {})).toEqual({ sent: 0 });
    vi.setSystemTime(start + 7 * DAY_MS);
    expect(await t.mutation(internal.signatures.sendReminders, {})).toEqual({ sent: 1 });
    vi.setSystemTime(start + 13 * DAY_MS);
    expect(await t.mutation(internal.signatures.sendReminders, {})).toEqual({ sent: 1 });
    expect((await signer(requestId, 'c1')).remindersSent).toEqual(['day3', 'day7', 'final']);
  });
});

describe('who can do what', () => {
  it('keeps setting up, cancelling and resending to documents.send', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });

    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    await expectCode(
      finance.as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] }),
      'auth.forbidden',
    );
    await expectCode(finance.as.mutation(api.signatures.cancelRequest, { requestId, reason: 'x' }), 'auth.forbidden');
    await expectCode(finance.as.mutation(api.signatures.resendLink, { requestId, signerId: 'c1' }), 'auth.forbidden');
    // Finance can read documents, so can see the request.
    expect(await finance.as.query(api.signatures.listForDocument, { documentId })).toHaveLength(1);

    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    await expectCode(
      pm.as.mutation(api.signatures.countersign, { requestId, typedName: 'PM', consent: true }),
      'auth.forbidden',
    );
  });

  it('hides a request from a member outside the document’s project', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });
    await expectCode(member.as.query(api.signatures.listForDocument, { documentId }), 'documents.notFound');
    await expectCode(member.as.mutation(api.signatures.verify, { requestId }), 'documents.notFound');
  });

  it('never shows a signer’s code or link hash to the team', async () => {
    const { as, memberId } = await owner();
    const documentId = await sentContract(memberId, as);
    const requestId = await as.mutation(api.signatures.createRequest, { documentId, contactIds: [adaId] });
    const token = await linkFor(requestId, 'c1');
    await t.mutation(internal.signatures.issueCode, { token, ip: FROM.ip });
    const [listed] = await as.query(api.signatures.listForDocument, { documentId });
    expect(JSON.stringify(listed)).not.toMatch(/tokenHash|codeHash/);

    const audit = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(JSON.stringify(audit)).not.toContain((await signer(requestId, 'c1')).codeHash!);
  });
});
