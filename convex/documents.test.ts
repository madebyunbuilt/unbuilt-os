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
    // The number comes with the first send; until then the draft says so instead of printing a dash.
    await t.run((ctx) =>
      ctx.db.patch('documents', documentId, { blocks: [{ kind: 'heading', text: 'Quote {{document.number}}' }] }),
    );
    const numbered = await as.query(api.documents.get, { documentId });
    expect(numbered?.blocks).toEqual([{ kind: 'heading', text: 'Quote (numbered when sent)' }]);
    expect(numbered?.missing).toEqual([]);
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

  it('writes the studio’s own details into the text', async () => {
    const { as } = await signedIn('owner');
    await t.run(async (ctx) => {
      const settings = await ctx.db.query('orgSettings').first();
      await ctx.db.patch('orgSettings', settings!._id, {
        legalName: 'Unbuilt Studio Ltd',
        addressLines: ['12 Example Street', 'Lagos'],
        email: 'hello@unbuilt.studio',
        phone: '+2348012345678',
        website: 'https://unbuilt.studio',
      });
    });
    const documentId = await as.mutation(api.documents.create, {
      type: 'other',
      clientId,
      title: 'Letterhead check',
      templateId: await t.run(async (ctx) => {
        const owner = (await ctx.db.query('teamMembers').first())!;
        void owner;
        return await ctx.db.insert('documentTemplates', {
          type: 'other',
          name: 'Letterhead check',
          version: 1,
          blocks: [
            {
              kind: 'paragraph',
              text: '{{org.legalName}}, {{org.address}}. {{org.email}} · {{org.phone}} · {{org.website}}',
            },
          ],
          variables: ['org.legalName', 'org.address', 'org.email', 'org.phone', 'org.website'],
          isDefault: false,
          requiresLegalReview: false,
          active: true,
        });
      }),
    });

    const document = await as.query(api.documents.get, { documentId });
    const text = (document?.blocks ?? []).map((block) => ('text' in block ? block.text : '')).join('\n');
    expect(text).toBe(
      'Unbuilt Studio Ltd, 12 Example Street, Lagos. hello@unbuilt.studio · +2348012345678 · https://unbuilt.studio',
    );
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

describe('sending', () => {
  /**
   * A draft with nothing missing: the seeded Payment clause prints the payment schedule, written on the draft, and the
   * agreements name the studio by its registered name and address.
   */
  async function ready(documentId: Id<'documents'>) {
    await t.run(async (ctx) => {
      await ctx.db.patch('documents', documentId, { paymentScheduleSummary: '50% on signature, 50% on completion' });
      const settings = (await ctx.db.query('orgSettings').first())!;
      await ctx.db.patch('orgSettings', settings._id, { legalName: 'Unbuilt Studio Ltd', addressLines: ['Lagos'] });
    });
    return documentId;
  }

  it('refuses to send while the wording promises a detail the app does not have, and says where to fill it', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'nda', clientId });
    const missing = (await as.query(api.documents.get, { documentId }))!.missing;
    // The seed sets no legal name or address for the studio, and the NDA names both.
    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'The studio’s registered name', href: '/settings/organisation' }),
        expect.objectContaining({ label: 'The studio’s address, on one line', href: '/settings/organisation' }),
      ]),
    );
    await expectCode(as.mutation(api.documents.send, { documentId }), 'documents.missingDetails');
    await expectCode(t.mutation(internal.documents.prepareSend, { documentId, memberId }), 'documents.missingDetails');

    await t.run(async (ctx) => {
      const settings = (await ctx.db.query('orgSettings').first())!;
      await ctx.db.patch('orgSettings', settings._id, { legalName: 'Unbuilt Studio Ltd', addressLines: ['Lagos'] });
    });
    expect((await as.query(api.documents.get, { documentId }))!.missing).toEqual([]);
    expect(await as.mutation(api.documents.send, { documentId })).toEqual({ sendingTo: ['ada@glossup.com'] });
  });

  it('links a draft to its own client’s deal or project, and writes the payment schedule on its own', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    const { dealId, otherDealId } = await t.run(async (ctx) => {
      const stage = (await ctx.db.query('pipelineStages').first())!;
      const deal = (client: Id<'clients'>) =>
        ctx.db.insert('deals', {
          title: 'Glossup app',
          clientId: client,
          stageId: stage._id,
          ownerMemberId: memberId,
          currency: 'NGN',
          valueMinor: 0,
          probabilityBps: 0,
          services: [],
          lastActivityAt: Date.now(),
        });
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
      return { dealId: await deal(clientId), otherDealId: await deal(otherClient) };
    });

    await expectCode(as.mutation(api.documents.link, { documentId, dealId: otherDealId }), 'documents.invalid');
    await as.mutation(api.documents.link, { documentId, dealId });
    expect((await t.run((ctx) => ctx.db.get('documents', documentId)))?.dealId).toBe(dealId);

    await expectCode(
      as.mutation(api.documents.setPaymentSchedule, { documentId, paymentScheduleSummary: '  ' }),
      'crm.invalid',
    );
    await as.mutation(api.documents.setPaymentSchedule, { documentId, paymentScheduleSummary: '100% upfront' });
    expect((await as.query(api.documents.get, { documentId }))!.missing).toEqual([]);

    // Only for those who may edit it, and never once it has been decided.
    const finance = await signedIn('finance');
    await expectCode(finance.as.mutation(api.documents.link, { documentId, dealId }), 'auth.forbidden');
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'accepted' }));
    await expectCode(
      as.mutation(api.documents.setPaymentSchedule, { documentId, paymentScheduleSummary: 'x' }),
      'documents.notEditable',
    );
  });

  it('fills the payment schedule from the draft’s own line, and asks for it until it is written', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    expect((await as.query(api.documents.get, { documentId }))!.missing).toEqual([
      expect.objectContaining({ fix: 'paymentSchedule' }),
    ]);
    const draft = await as.query(api.documents.get, { documentId });
    await as.mutation(api.documents.update, {
      documentId,
      title: 'Quote for Glossup',
      validUntilDate: draft!.validUntilDate,
      paymentScheduleSummary: '50% on signature, 50% on completion',
    });
    const document = await as.query(api.documents.get, { documentId });
    expect(document!.missing).toEqual([]);
    expect(JSON.stringify(document!.blocks)).toContain('The payment schedule for this work is: 50% on signature');
  });

  it('checks the send before scheduling it, and refuses one that cannot go out', async () => {
    const { as } = await signedIn('owner');
    const documentId = await ready(
      await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines }),
    );

    expect(await as.mutation(api.documents.send, { documentId })).toEqual({ sendingTo: ['ada@glossup.com'] });

    // Nothing has changed yet: the action does the work, and the document is still a draft until it has.
    expect(await t.run((ctx) => ctx.db.get('documents', documentId))).toMatchObject({ status: 'draft' });

    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'signed' }));
    await expectCode(as.mutation(api.documents.send, { documentId }), 'documents.signed');
  });

  it('is closed to a role without documents.send', async () => {
    const owner = await signedIn('owner');
    const documentId = await ready(
      await owner.as.mutation(api.documents.create, {
        type: 'quote',
        clientId,
        lineItems: twoLines,
      }),
    );
    // Finance reads every document but does not send one; project managers do hold documents.send.
    const finance = await signedIn('finance');
    await expect(finance.as.mutation(api.documents.send, { documentId })).rejects.toThrow();

    const pm = await signedIn('project_manager');
    expect(await pm.as.mutation(api.documents.send, { documentId })).toEqual({ sendingTo: ['ada@glossup.com'] });
  });

  it('tells whoever pressed send when it did not go out', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await ready(
      await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines }),
    );
    await t.mutation(internal.documents.reportSendFailed, {
      documentId,
      memberId,
      reason: 'Could not send the document email: validation_error',
    });
    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notifications).toEqual([expect.objectContaining({ event: 'document_send_failed', recipientId: memberId })]);
  });

  /** The three steps the send action brackets the PDF render with. */
  async function prepare(documentId: Id<'documents'>, memberId: Id<'teamMembers'>, contactIds?: Id<'contacts'>[]) {
    return await t.mutation(internal.documents.prepareSend, { documentId, memberId, contactIds });
  }

  it('numbers the document once, snapshots the version and addresses the primary contact', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await ready(
      await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines }),
    );

    const first = await prepare(documentId, memberId);
    expect(first.number).toBe('UNB-QUO-0001');
    expect(first.version).toBe(1);
    expect(first.recipients).toEqual([{ id: contactId, name: 'Ada Obi', email: 'ada@glossup.com' }]);
    expect(first.pdf.totals?.totalMinor).toBe(2_075_000);
    expect(first.pdf.org.email).toBeUndefined();

    // The version row holds the text and prices as they were sent, and cannot be edited afterwards.
    const versions = await t.run((ctx) => ctx.db.query('documentVersions').collect());
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ documentId, version: 1, createdBy: memberId });

    // A send that never got its PDF is retried into the same version, rather than stacking another.
    const retried = await prepare(documentId, memberId);
    expect(retried.number).toBe('UNB-QUO-0001');
    expect(retried.version).toBe(1);
    expect(await t.run((ctx) => ctx.db.query('documentVersions').collect())).toHaveLength(1);

    // Once that version has its PDF, the next send is the next version.
    await t.run(async (ctx) => {
      const version = (await ctx.db.query('documentVersions').first())!;
      const fileId = await ctx.db.insert('files', {
        storageId: (await ctx.storage.store(new Blob(['%PDF-1.7 pretend']))) as Id<'_storage'>,
        name: 'UNB-QUO-0001.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 16,
        sha256: 'b'.repeat(64),
        owner: { table: 'documents', id: documentId },
        visibility: 'client',
        uploadedByKind: 'team',
        uploadedById: memberId,
      });
      await ctx.db.patch('documentVersions', version._id, { pdfFileId: fileId, pdfSha256: 'b'.repeat(64) });
    });
    const second = await prepare(documentId, memberId);
    expect(second.version).toBe(2);
    expect(await t.run((ctx) => ctx.db.query('documentVersions').collect())).toHaveLength(2);
  });

  it('refuses to draft a type with no template, since there would be no wording', async () => {
    const { as } = await signedIn('owner');
    await t.run(async (ctx) => {
      for (const template of await ctx.db.query('documentTemplates').collect()) {
        if (template.type === 'sla') await ctx.db.patch('documentTemplates', template._id, { active: false });
      }
    });
    await expectCode(as.mutation(api.documents.create, { type: 'sla', clientId }), 'documents.noTemplate');
  });

  it('sends to the contacts chosen, and refuses a client with nobody to send to', async () => {
    const { as, memberId } = await signedIn('owner');
    const second = await t.run((ctx) =>
      ctx.db.insert('contacts', {
        clientId,
        name: 'Bayo Ade',
        email: 'bayo@glossup.com',
        isPrimary: false,
        isBilling: true,
        portalAccess: false,
        status: 'active',
      }),
    );
    const documentId = await ready(
      await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines }),
    );
    const prepared = await prepare(documentId, memberId, [contactId, second]);
    expect(prepared.recipients.map((r) => r.email)).toEqual(['ada@glossup.com', 'bayo@glossup.com']);

    // A contact who has left is not a recipient.
    await t.run(async (ctx) => {
      await ctx.db.patch('contacts', contactId, { status: 'left' });
      await ctx.db.patch('contacts', second, { status: 'left' });
    });
    const orphan = await ready(
      await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines }),
    );
    await expectCode(prepare(orphan, memberId), 'documents.noRecipients');
  });

  it('refuses to send a signed or void document', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await ready(
      await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines }),
    );
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'void', voidReason: 'wrong client' }));
    await expectCode(prepare(documentId, memberId), 'documents.void');

    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'signed' }));
    await expectCode(prepare(documentId, memberId), 'documents.signed');
  });

  it('attaches the stored PDF with its hash to the document and the version', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await ready(
      await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines }),
    );
    const prepared = await prepare(documentId, memberId);

    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(['%PDF-1.7 pretend'])));
    const stored = await t.mutation(internal.documents.attachPdf, {
      documentId,
      version: prepared.version,
      storageId,
      fileName: `${prepared.number}.pdf`,
      memberId,
    });
    expect(stored.ok).toBe(true);

    const document = await t.run((ctx) => ctx.db.get('documents', documentId));
    const version = await t.run((ctx) => ctx.db.query('documentVersions').first());
    expect(document?.pdfSha256).toHaveLength(64);
    expect(version?.pdfSha256).toBe(document?.pdfSha256);
    expect(version?.pdfFileId).toBe(document?.pdfFileId);

    // The file is the client's to read, and belongs to the document.
    const file = await t.run((ctx) => ctx.db.get('files', document!.pdfFileId!));
    expect(file).toMatchObject({ visibility: 'client', mimeType: 'application/pdf', owner: { table: 'documents' } });
  });

  it('marks a quote sent and a contract awaiting signature, and records it', async () => {
    const { as, memberId } = await signedIn('owner');
    const quoteId = await ready(
      await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines }),
    );
    await prepare(quoteId, memberId);
    await t.mutation(internal.documents.markSent, { documentId: quoteId, version: 1, emailed: ['ada@glossup.com'] });
    expect(await t.run((ctx) => ctx.db.get('documents', quoteId))).toMatchObject({ status: 'sent' });

    const contractId = await ready(await as.mutation(api.documents.create, { type: 'contract', clientId }));
    await prepare(contractId, memberId);
    await t.mutation(internal.documents.markSent, { documentId: contractId, version: 1, emailed: ['ada@glossup.com'] });
    expect(await t.run((ctx) => ctx.db.get('documents', contractId))).toMatchObject({ status: 'awaiting_signature' });

    const activity = await t.run((ctx) => ctx.db.query('activities').collect());
    expect(activity.some((entry) => entry.title.includes('UNB-QUO-0001 sent to ada@glossup.com'))).toBe(true);
  });
});

describe('changing a sent document', () => {
  /** A quote sent as version 1, the way the send action leaves it. */
  async function sentQuote(as: Awaited<ReturnType<typeof signedIn>>['as'], memberId: Id<'teamMembers'>) {
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await t.run(async (ctx) => {
      await ctx.db.patch('documents', documentId, { paymentScheduleSummary: '50% on signature, 50% on completion' });
      const settings = (await ctx.db.query('orgSettings').first())!;
      await ctx.db.patch('orgSettings', settings._id, { legalName: 'Unbuilt Studio Ltd', addressLines: ['Lagos'] });
    });
    const prepared = await t.mutation(internal.documents.prepareSend, { documentId, memberId });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['%PDF-1.7 quote'])));
    await t.mutation(internal.documents.attachPdf, {
      documentId,
      version: prepared.version,
      storageId,
      fileName: 'q.pdf',
      memberId,
    });
    await t.mutation(internal.documents.markSent, { documentId, version: prepared.version, emailed: [] });
    return documentId;
  }

  it('edits a sent document into its next version, which the client only gets when it is sent', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await sentQuote(as, memberId);
    const sent = (await as.query(api.documents.get, { documentId }))!;
    expect(sent.unsentChanges).toBe(false);

    await as.mutation(api.documents.update, {
      documentId,
      title: 'Quote for Glossup, revised',
      validUntilDate: sent.validUntilDate,
      paymentScheduleSummary: '100% upfront',
      blocks: [...sent.rawBlocks, { kind: 'paragraph', text: 'We have added a second phase.' }],
    });
    const edited = (await as.query(api.documents.get, { documentId }))!;
    expect(edited).toMatchObject({ status: 'sent', unsentChanges: true, canDiscard: true, currentVersion: 1 });
    // What the client has is untouched.
    const v1 = await t.run((ctx) => ctx.db.query('documentVersions').first());
    expect(JSON.stringify(v1?.blocks)).not.toContain('second phase');

    // Sending makes version 2 and clears the flag.
    const prepared = await t.mutation(internal.documents.prepareSend, { documentId, memberId });
    expect(prepared.version).toBe(2);
    expect(JSON.stringify(prepared.pdf.blocks)).toContain('second phase');
    await t.mutation(internal.documents.markSent, { documentId, version: 2, emailed: [] });
    expect((await as.query(api.documents.get, { documentId }))?.unsentChanges).toBe(false);
  });

  it('discards unsent changes back to exactly what the last version said', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await sentQuote(as, memberId);
    const before = await t.run((ctx) => ctx.db.get('documents', documentId));
    await as.mutation(api.documents.update, {
      documentId,
      title: 'Something else',
      validUntilDate: before!.validUntilDate,
      lineItems: [{ description: 'Design', quantityMilli: 5_000, unitPriceMinor: 1_000_000 }],
      blocks: [{ kind: 'paragraph', text: 'Rewritten' }],
    });
    await as.mutation(api.documents.discardChanges, { documentId });
    const after = await t.run((ctx) => ctx.db.get('documents', documentId));
    expect(after).toMatchObject({
      title: before!.title,
      blocks: before!.blocks,
      totals: before!.totals,
      unsentChanges: false,
    });
  });

  it('keeps a decided, signed or void document, and one out for signing, from changing', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await sentQuote(as, memberId);
    const edit = () => as.mutation(api.documents.update, { documentId, title: 'Changed' });
    for (const status of ['accepted', 'declined', 'partially_signed', 'void'] as const) {
      await t.run((ctx) => ctx.db.patch('documents', documentId, { status }));
      await expectCode(edit(), 'documents.notEditable');
    }
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'signed' }));
    await expectCode(edit(), 'documents.signed');

    // An open signing request holds the version still.
    await t.run(async (ctx) => {
      await ctx.db.patch('documents', documentId, { status: 'awaiting_signature' });
      await ctx.db.insert('signatureRequests', {
        documentId,
        documentVersion: 1,
        pdfSha256: 'a'.repeat(64),
        order: 'sequential',
        status: 'pending',
        expiresAt: Date.now() + 86_400_000,
        createdByMemberId: memberId,
        signers: [],
      });
    });
    await expectCode(edit(), 'documents.signing');
  });

  it('records which version a decision was for', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await sentQuote(as, memberId);
    const sent = (await as.query(api.documents.get, { documentId }))!;
    await as.mutation(api.documents.update, { documentId, title: 'Revised', validUntilDate: sent.validUntilDate });
    await as.mutation(api.documents.recordDecision, { documentId, decision: 'accepted', note: 'On the phone' });
    expect((await as.query(api.documents.get, { documentId }))?.decidedVersion).toBe(1);
  });
});

describe('view tracking', () => {
  it('records a team member looking without counting it as the client seeing it', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'sent', number: 'UNB-QUO-0009' }));

    await as.mutation(api.documents.logTeamView, { documentId });
    const document = await t.run((ctx) => ctx.db.get('documents', documentId));
    expect(document).toMatchObject({ status: 'sent', viewCount: 0 });
    expect(document?.firstViewedAt).toBeUndefined();

    const views = await t.run((ctx) => ctx.db.query('documentViews').collect());
    expect(views).toEqual([expect.objectContaining({ viewerKind: 'member', viewerId: memberId })]);
  });

  it('moves a sent document to viewed on the client’s first look and tells whoever drafted it', async () => {
    const { as, memberId } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'sent', number: 'UNB-QUO-0010' }));

    await t.mutation(internal.documents.recordClientView, {
      documentId,
      contactId,
      viewerKind: 'contact',
      ip: '102.89.0.1',
      userAgent: 'Safari',
    });
    let document = await t.run((ctx) => ctx.db.get('documents', documentId));
    expect(document).toMatchObject({ status: 'viewed', viewCount: 1 });
    expect(document?.firstViewedAt).toBeDefined();

    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notifications.filter((row) => row.event === 'document_viewed' && row.recipientId === memberId)).toHaveLength(
      1,
    );

    // A second look counts, but the studio is told only once.
    await t.mutation(internal.documents.recordClientView, { documentId, contactId, viewerKind: 'contact' });
    document = await t.run((ctx) => ctx.db.get('documents', documentId));
    expect(document).toMatchObject({ viewCount: 2 });
    expect(
      (await t.run((ctx) => ctx.db.query('notifications').collect())).filter((row) => row.event === 'document_viewed'),
    ).toHaveLength(1);
  });

  it('leaves an accepted document as accepted when the client looks again', async () => {
    const { as } = await signedIn('owner');
    const documentId = await as.mutation(api.documents.create, { type: 'quote', clientId, lineItems: twoLines });
    await t.run((ctx) => ctx.db.patch('documents', documentId, { status: 'accepted', number: 'UNB-QUO-0011' }));
    await t.mutation(internal.documents.recordClientView, { documentId, contactId, viewerKind: 'contact' });
    expect(await t.run((ctx) => ctx.db.get('documents', documentId))).toMatchObject({ status: 'accepted' });
  });
});
