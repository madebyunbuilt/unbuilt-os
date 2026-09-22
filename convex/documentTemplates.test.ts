import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { DEFAULT_CLAUSES, DEFAULT_DOCUMENT_TEMPLATES } from './lib/documentTemplateSeeds';
import { createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

// Templates and clauses (07-documents-and-esign.md). The rules that matter: a template can only name variables the app
// can fill in, editing either makes a new version, and neither is ever deleted, so existing documents keep their text.

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;

/** Someone signed in with the given system role. */
async function signedIn(key: 'owner' | 'admin' | 'project_manager' | 'member') {
  const { as } = await createTeamMember(t, roles[key], { email: `${key}@unbuilt.studio` }, { twoFactorEnabled: true });
  return as;
}

beforeEach(async () => {
  t = newTest();
  roles = await seedRoles(t);
  await t.mutation(internal.seed.run, {});
});

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

describe('clauses', () => {
  it('lists the seeded clauses and hides retired ones', async () => {
    const owner = await signedIn('owner');
    const listed = await owner.query(api.clauses.list, {});
    expect(listed).toHaveLength(DEFAULT_CLAUSES.length);
    expect(listed.every((clause) => clause.version === 1)).toBe(true);
  });

  it('raises the version when the wording changes, and leaves it when only the title does', async () => {
    const owner = await signedIn('owner');
    const [clause] = await owner.query(api.clauses.list, {});

    const sameWords = await owner.mutation(api.clauses.update, {
      clauseId: clause.id,
      title: 'Who this agreement is between',
      body: clause.body,
      category: clause.category,
    });
    expect(sameWords.version).toBe(1);

    const rewritten = await owner.mutation(api.clauses.update, {
      clauseId: clause.id,
      title: 'Who this agreement is between',
      body: 'This agreement is between {{org.legalName}} and {{client.legalName}}.',
      category: clause.category,
    });
    expect(rewritten.version).toBe(2);
  });

  it('refuses a clause naming a variable the app cannot fill in', async () => {
    const owner = await signedIn('owner');
    await expectCode(
      owner.mutation(api.clauses.create, {
        key: 'made-up',
        title: 'Made up',
        body: 'Payable by {{clinet.legalName}} on receipt.',
        category: 'Money',
      }),
      'documents.unknownVariable',
    );
  });

  it('refuses to retire a clause an active template still uses', async () => {
    const owner = await signedIn('owner');
    const payment = (await owner.query(api.clauses.list, {})).find((clause) => clause.key === 'payment-terms')!;
    await expectCode(
      owner.mutation(api.clauses.setActive, { clauseId: payment.id, active: false }),
      'documents.clauseInUse',
    );
  });

  it('keeps clauses away from roles that do not manage templates', async () => {
    const member = await signedIn('member');
    await expect(member.query(api.clauses.list, {})).rejects.toThrow();

    const pm = await signedIn('project_manager');
    const [clause] = await pm.query(api.clauses.list, {});
    expect(clause.key).toBeTruthy();
  });
});

describe('document templates', () => {
  it('seeds one default template per type, with the legal ones flagged', async () => {
    const owner = await signedIn('owner');
    const templates = await owner.query(api.documentTemplates.list, {});
    expect(templates).toHaveLength(DEFAULT_DOCUMENT_TEMPLATES.length);
    expect(templates.every((template) => template.isDefault)).toBe(true);

    const flagged = templates.filter((template) => template.requiresLegalReview).map((template) => template.type);
    expect(flagged.sort()).toEqual(['contract', 'dpa', 'nda', 'team_agreement']);
  });

  it('records the variables a template uses', async () => {
    const owner = await signedIn('owner');
    const quote = (await owner.query(api.documentTemplates.list, { type: 'quote' }))[0];
    expect(quote.variables).toContain('contact.name');
    expect(quote.variables).toContain('today');
    // A clause's own variables are not listed here: the clause is checked when it is saved, and filled with the rest
    // when the document is read or sent.
    expect(quote.variables).not.toContain('validUntil');
  });

  it('refuses a template that names an unknown variable or a missing clause', async () => {
    const owner = await signedIn('owner');
    await expectCode(
      owner.mutation(api.documentTemplates.create, {
        type: 'proposal',
        name: 'Broken proposal',
        blocks: [{ kind: 'paragraph', text: 'Prepared for {{contact.fullname}}' }],
      }),
      'documents.unknownVariable',
    );
    await expectCode(
      owner.mutation(api.documentTemplates.create, {
        type: 'proposal',
        name: 'Missing clause',
        blocks: [{ kind: 'clause', clauseKey: 'no-such-clause' }],
      }),
      'documents.clauseMissing',
    );
  });

  it('insists a priced template shows its total', async () => {
    const owner = await signedIn('owner');
    await expectCode(
      owner.mutation(api.documentTemplates.create, {
        type: 'quote',
        name: 'Quote without a price',
        blocks: [{ kind: 'paragraph', text: 'We will do the work for a fair price.' }],
      }),
      'documents.invalid',
    );
  });

  it('makes a new version when the blocks change, and keeps one default per type', async () => {
    const owner = await signedIn('owner');
    const quote = (await owner.query(api.documentTemplates.list, { type: 'quote' }))[0];

    const edited = await owner.mutation(api.documentTemplates.update, {
      templateId: quote.id,
      name: quote.name,
      blocks: [...quote.blocks, { kind: 'paragraph', text: 'Thank you for your time, {{contact.name}}.' }],
    });
    expect(edited.version).toBe(2);

    const second = await owner.mutation(api.documentTemplates.create, {
      type: 'quote',
      name: 'Short quote',
      isDefault: true,
      blocks: [{ kind: 'lineItems' }, { kind: 'totals' }],
    });
    const quotes = await owner.query(api.documentTemplates.list, { type: 'quote' });
    expect(quotes.filter((template) => template.isDefault).map((template) => template.id)).toEqual([second]);
  });

  it('lets a project manager read templates but not change them', async () => {
    const pm = await signedIn('project_manager');
    const templates = await pm.query(api.documentTemplates.list, {});
    expect(templates.length).toBeGreaterThan(0);

    const member = await signedIn('member');
    await expect(member.query(api.documentTemplates.list, {})).rejects.toThrow();
    await expect(
      member.mutation(api.documentTemplates.setActive, {
        templateId: templates[0].id as Id<'documentTemplates'>,
        active: false,
      }),
    ).rejects.toThrow();
  });
});

describe('the lawyer\u2019s approval', () => {
  async function contract(owner: Awaited<ReturnType<typeof signedIn>>) {
    return (await owner.query(api.documentTemplates.list, { type: 'contract' }))[0];
  }

  it('is recorded by the Owner against the version read, and lapses when the wording changes', async () => {
    const owner = await signedIn('owner');
    const before = await contract(owner);
    expect(before.needsLegalReview).toBe(true);

    await owner.mutation(api.documentTemplates.recordLegalApproval, {
      templateId: before.id,
      version: before.version,
      note: 'Reviewed by Adaeze Okafor, Okafor & Co',
    });
    const approved = await contract(owner);
    expect(approved.needsLegalReview).toBe(false);
    expect(approved.legalApproval).toMatchObject({ version: 1, note: 'Reviewed by Adaeze Okafor, Okafor & Co' });

    // Changing the wording makes version 2, which the lawyer has not read.
    await owner.mutation(api.documentTemplates.update, {
      templateId: approved.id,
      name: approved.name,
      blocks: [...approved.blocks, { kind: 'paragraph', text: 'An extra paragraph.' }],
    });
    expect((await contract(owner)).needsLegalReview).toBe(true);
  });

  it('refuses an approval for a version that has moved on', async () => {
    const owner = await signedIn('owner');
    const template = await contract(owner);
    await owner.mutation(api.documentTemplates.update, {
      templateId: template.id,
      name: template.name,
      blocks: [...template.blocks, { kind: 'paragraph', text: 'Changed while the Owner was reading.' }],
    });
    await expectCode(
      owner.mutation(api.documentTemplates.recordLegalApproval, { templateId: template.id, version: 1 }),
      'documents.staleVersion',
    );
  });

  it('is the Owner\u2019s alone to record', async () => {
    const owner = await signedIn('owner');
    const template = await contract(owner);
    for (const key of ['admin', 'project_manager'] as const) {
      const other = await signedIn(key);
      await expectCode(
        other.mutation(api.documentTemplates.recordLegalApproval, { templateId: template.id, version: 1 }),
        'documents.ownerOnly',
      );
    }
  });

  it('is only for the templates that need it', async () => {
    const owner = await signedIn('owner');
    const quote = (await owner.query(api.documentTemplates.list, { type: 'quote' }))[0];
    expect(quote.needsLegalReview).toBe(false);
    await expectCode(
      owner.mutation(api.documentTemplates.recordLegalApproval, { templateId: quote.id, version: quote.version }),
      'documents.invalid',
    );
  });
});

describe('the signing process review', () => {
  it('stays off until the Owner records it, and can be withdrawn', async () => {
    const owner = await signedIn('owner');
    expect(await owner.query(api.settings.signatureProcessReview, {})).toEqual({ reviewed: false });

    await owner.mutation(api.settings.setSignatureProcessReview, { reviewed: true, note: 'Okafor & Co, 22 Sept' });
    expect(await owner.query(api.settings.signatureProcessReview, {})).toMatchObject({
      reviewed: true,
      note: 'Okafor & Co, 22 Sept',
    });

    await owner.mutation(api.settings.setSignatureProcessReview, { reviewed: false });
    expect(await owner.query(api.settings.signatureProcessReview, {})).toEqual({ reviewed: false });
  });

  it('cannot be recorded by an Admin', async () => {
    const admin = await signedIn('admin');
    await expectCode(admin.mutation(api.settings.setSignatureProcessReview, { reviewed: true }), 'settings.ownerOnly');
  });
});
