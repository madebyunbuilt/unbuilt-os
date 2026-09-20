import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

// Documents (07-documents-and-esign.md). What matters here: a document owns its text from the moment it is created,
// prices follow the client's tax settings, the chain holds together, and a decision recorded by the studio says so.

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;
let clientId: Id<'clients'>;
let contactId: Id<'contacts'>;

async function signedIn(key: 'owner' | 'project_manager' | 'member' | 'finance', email = `${key}@unbuilt.studio`) {
  const member = await createTeamMember(t, roles[key], { email }, { twoFactorEnabled: true });
  return member;
}

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
  vi.setSystemTime(new Date('2026-09-21T09:00:00+01:00'));
  t = newTest();
  roles = await seedRoles(t);
  await t.mutation(internal.seed.run, {});
  ({ clientId, contactId } = await t.run(async (ctx) => {
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
      timezone: 'Africa/Lagos',
      tags: [],
      portalEnabled: false,
    });
    const contactId = await ctx.db.insert('contacts', {
      clientId,
      name: 'Ada Obi',
      email: 'ada@glossup.com',
      jobTitle: 'Founder',
      isPrimary: true,
      isBilling: true,
      portalAccess: false,
      status: 'active',
    });
    return { clientId, contactId };
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

const twoLines = [
  { description: 'Design', quantityMilli: 1_000, unitPriceMinor: 1_000_000 },
  { description: 'Build', quantityMilli: 2_000, unitPriceMinor: 500_000, taxable: false },
];

describe('creating a document', () => {
  it('fills the template in, prices it with the client’s taxes, and dates a quote', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, {
      type: 'quote',
      clientId,
      lineItems: twoLines,
    });

    const document = await as.query(api.documents.get, { documentId });
    expect(document?.title).toBe('Quote for Glossup');
    expect(document?.status).toBe('draft');
    expect(document?.number).toBeUndefined();
    // 1 × 10,000 + 2 × 5,000 = 20,000; VAT 7.5% on the taxable line only; WHT 5% of the net.
    expect(document?.totals).toMatchObject({
      subtotalMinor: 2_000_000,
      taxableMinor: 1_000_000,
      vatMinor: 75_000,
      totalMinor: 2_075_000,
      whtExpectedMinor: 100_000,
    });
    expect(document?.validUntilDate).toBe('2026-10-21');

    // The client's and studio's details are written into the text, not left as variables.
    const text = (document?.blocks ?? []).map((block) => ('text' in block ? block.text : '')).join('\n');
    expect(text).toContain('Ada Obi');
    expect(text).toContain('Glossup');
    expect(text).not.toContain('{{');
  });

  it('keeps its wording when the clause behind it is rewritten', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    const before = await as.query(api.documents.get, { documentId });

    const payment = (await as.query(api.clauses.list, {})).find((clause) => clause.key === 'payment-terms')!;
    await as.mutation(api.clauses.update, {
      clauseId: payment.id,
      title: payment.title,
      body: 'Payable in advance, in full, no exceptions.',
      category: payment.category,
    });

    const after = await as.query(api.documents.get, { documentId });
    expect(after?.blocks).toEqual(before?.blocks);
    expect(JSON.stringify(after?.blocks)).not.toContain('no exceptions');
  });

  it('refuses a project belonging to another client', async () => {
    const { as, memberId } = await signedIn('owner');
    const otherProject = await t.run(async (ctx) => {
      const otherClient = await ctx.db.insert('clients', {
        displayName: 'Qravit',
        kind: 'company',
        status: 'active',
        country: 'NG',
        addressLines: [],
        vatTreatment: 'standard',
        whtApplies: false,
        defaultCurrency: 'NGN',
        timezone: 'Africa/Lagos',
        tags: [],
        portalEnabled: false,
      });
      return await ctx.db.insert('projects', {
        code: 'UNB-P-0001',
        name: 'Other work',
        clientId: otherClient,
        type: 'web_platform',
        status: 'active',
        billingModel: 'fixed',
        currency: 'NGN',
        startDate: '2026-09-01',
        managerMemberId: memberId,
        links: {},
        handoverStatus: 'not_started',
      });
    });
    await expectCode(
      as.mutation(api.documents.create, { type: 'sow', clientId, projectId: otherProject }),
      'documents.invalid',
    );
  });
});

describe('the document chain', () => {
  it('carries the client, prices and chain from quote to proposal to SOW', async () => {
    const { as } = await signedIn('owner');
    const quoteId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    const proposalId = await as.mutation(api.documents.createFromParent, {
      parentDocumentId: quoteId,
      type: 'proposal',
    });
    const sowId = await as.mutation(api.documents.createFromParent, {
      parentDocumentId: proposalId,
      type: 'sow',
    });

    const sow = await as.query(api.documents.get, { documentId: sowId });
    expect(sow?.parentDocumentId).toBe(proposalId);
    expect(sow?.chainRootId).toBe(quoteId);
    expect(sow?.totals?.totalMinor).toBe(2_075_000);
    expect(sow?.chain.map((row) => row.type)).toEqual(['quote', 'proposal', 'sow']);
  });

  it('will not delete a document another was made from', async () => {
    const { as } = await signedIn('owner');
    const quoteId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await as.mutation(api.documents.createFromParent, { parentDocumentId: quoteId, type: 'proposal' });
    await expectCode(as.mutation(api.documents.remove, { documentId: quoteId }), 'documents.hasChildren');
  });
});

describe('editing', () => {
  it('re-prices the lines it is given', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await as.mutation(api.documents.update, {
      documentId,
      title: 'Quote for the first phase',
      lineItems: [{ description: 'Design only', quantityMilli: 1_000, unitPriceMinor: 1_500_000 }],
    });
    const document = await as.query(api.documents.get, { documentId });
    expect(document?.title).toBe('Quote for the first phase');
    expect(document?.totals).toMatchObject({ subtotalMinor: 1_500_000, vatMinor: 112_500, totalMinor: 1_612_500 });
  });

  it('refuses a quantity or price that makes no sense', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await expectCode(
      as.mutation(api.documents.update, {
        documentId,
        title: 'Quote',
        lineItems: [{ description: 'Nothing', quantityMilli: 0, unitPriceMinor: 100 }],
      }),
      'documents.invalid',
    );
  });
});

describe('decisions the studio records', () => {
  /** Puts a document in the client's hands, which sending will do properly in the next step. */
  async function withClient(documentId: Id<'documents'>) {
    await t.run((ctx) =>
      ctx.db.patch('documents', documentId, { status: 'sent', sentAt: Date.now(), number: 'UNB-QUO-0001' }),
    );
  }

  it('records who accepted it and keeps that it came from the studio', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await withClient(documentId);

    await as.mutation(api.documents.recordDecision, {
      documentId,
      decision: 'accepted',
      contactId,
      note: 'Ada confirmed by email',
    });
    const document = await t.run((ctx) => ctx.db.get('documents', documentId));
    expect(document).toMatchObject({
      status: 'accepted',
      acceptedByContactId: contactId,
      decisionRecordedByMemberId: memberId,
      decisionNote: 'Ada confirmed by email',
    });

    const activity = await t.run((ctx) => ctx.db.query('activities').collect());
    expect(activity.some((entry) => entry.title.includes('recorded by the studio'))).toBe(true);
  });

  it('insists on a reason for a decline, and only while the client has it', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await expectCode(
      as.mutation(api.documents.recordDecision, { documentId, decision: 'accepted' }),
      'documents.notWithClient',
    );

    await withClient(documentId);
    await expectCode(
      as.mutation(api.documents.recordDecision, { documentId, decision: 'declined' }),
      'documents.needsReason',
    );
    await as.mutation(api.documents.recordDecision, { documentId, decision: 'declined', note: 'Budget moved' });
    expect(await t.run((ctx) => ctx.db.get('documents', documentId))).toMatchObject({
      status: 'declined',
      declinedReason: 'Budget moved',
    });
  });
});

describe('void and delete', () => {
  it('voids with a reason, keeps the number, and never touches a signed document', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'sent', number: 'UNB-QUO-0002' }));

    await as.mutation(api.documents.voidDocument, { documentId, reason: 'Sent to the wrong client' });
    expect(await t.run((ctx) => ctx.db.get('documents', documentId))).toMatchObject({
      status: 'void',
      number: 'UNB-QUO-0002',
      voidReason: 'Sent to the wrong client',
    });

    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'signed' }));
    await expectCode(
      as.mutation(api.documents.voidDocument, { documentId, reason: 'Changed my mind' }),
      'documents.signed',
    );
  });

  it('keeps a sent document on record instead of deleting it', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await t.run((ctx) => ctx.db.patch('documents', documentId, { number: 'UNB-QUO-0003', currentVersion: 1 }));
    await expectCode(as.mutation(api.documents.remove, { documentId }), 'documents.sent');
  });
});

describe('expiry', () => {
  it('expires a quote whose date has passed and tells whoever drafted it', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, {
      type: 'quote',
      clientId,
      lineItems: twoLines,
      validUntilDate: '2026-09-20',
    });
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'sent' }));

    expect(await t.mutation(internal.documents.expireOverdue, {})).toEqual({ expired: 1 });
    expect(await t.run((ctx) => ctx.db.get('documents', documentId))).toMatchObject({ status: 'expired' });

    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(
      notifications.filter((row) => row.recipientId === memberId && row.event === 'document_expired'),
    ).toHaveLength(1);

    // Running again changes nothing: it is no longer sent or viewed.
    expect(await t.mutation(internal.documents.expireOverdue, {})).toEqual({ expired: 0 });
  });

  it('leaves a contract alone, since only quotes and proposals expire', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, {
      type: 'contract',
      clientId,
      validUntilDate: '2026-09-01',
    });
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'sent' }));
    expect(await t.mutation(internal.documents.expireOverdue, {})).toEqual({ expired: 0 });
  });
});

describe('who can see and do what', () => {
  it('lets Finance read every document and a Member only their project’s', async () => {
    const owner = await signedIn('owner');
    const documentId = await owner.as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });

    const finance = await signedIn('finance');
    expect(await finance.as.query(api.documents.list, {})).toHaveLength(1);

    const member = await signedIn('member');
    expect(await member.as.query(api.documents.list, {})).toEqual([]);
    await expectCode(member.as.query(api.documents.get, { documentId }), 'documents.notFound');

    // On a project the Member belongs to, the same document is theirs to read.
    const projectId = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert('projects', {
        code: 'UNB-P-0002',
        name: 'Glossup app',
        clientId,
        type: 'mobile_app',
        status: 'active',
        billingModel: 'fixed',
        currency: 'NGN',
        startDate: '2026-09-01',
        managerMemberId: owner.memberId,
        links: {},
        handoverStatus: 'not_started',
      });
      await ctx.db.insert('projectMembers', { projectId, memberId: member.memberId, joinedAt: Date.now() });
      await ctx.db.patch('documents', documentId, { projectId });
      return projectId;
    });
    expect((await member.as.query(api.documents.list, {})).map((row) => row.projectId)).toEqual([projectId]);
    expect((await member.as.query(api.documents.get, { documentId }))?.id).toBe(documentId);
  });

  it('keeps drafting and voiding to the roles that hold those keys', async () => {
    const { as } = await signedIn('finance');
    await expect(as.mutation(api.documents.create, { type: 'quote', clientId })).rejects.toThrow();

    const owner = await signedIn('owner');
    const documentId = await owner.as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await expect(as.mutation(api.documents.voidDocument, { documentId, reason: 'no' })).rejects.toThrow();
  });
});
