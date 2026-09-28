import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { REDACTED } from './lib/audit';
import { nextNumber } from './lib/numbering';
import { DEFAULT_ORG_SETTINGS } from './lib/settings';
import { createClientUser, createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';

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

beforeEach(async () => {
  vi.stubEnv('FILE_URL_SECRET', 'a-test-secret-that-is-at-least-32-chars');
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  t = newTest();
  roles = await seedRoles(t);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const organisation = {
  legalName: 'Unbuilt Studio Ltd',
  tradingName: 'Unbuilt',
  addressLines: [' 12 Example Street ', '', 'Lagos'],
  country: 'NG',
  tin: '12345678-0001',
  vatNumber: undefined,
  email: ' Hello@Unbuilt.Studio ',
  phone: '+234 801 234 5678',
  website: 'unbuilt.studio',
  timezone: 'Africa/Lagos',
  retentionYears: 7,
  brand: { primary: '#000000', accent: '#ffc400' },
};

const billing = {
  defaultCurrency: 'NGN' as const,
  bankAccounts: [
    {
      label: 'Naira',
      currency: 'NGN' as const,
      bankName: 'Example Bank',
      accountName: 'Unbuilt',
      accountNumber: '0123456789',
    },
  ],
  numbering: { invoice: { prefix: 'INV', padding: 5 } },
  defaultPaymentTermsDays: 14,
  defaultVatBps: 750,
  lateFeePolicy: { enabled: false, monthlyBps: 500 },
  invoiceFooter: 'Thank you.',
  quoteValidityDays: 30,
};

describe('organisation settings', () => {
  it('returns defaults before anything is saved, without bank accounts', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const view = await admin.as.query(api.settings.getOrganisation, {});
    expect(view).toMatchObject({ country: 'NG', timezone: 'Africa/Lagos', retentionYears: 7 });
    expect(view).not.toHaveProperty('bankAccounts');
  });

  it('saves cleaned values with one audit entry', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    await t.run((ctx) => ctx.db.insert('orgSettings', DEFAULT_ORG_SETTINGS));
    await admin.as.mutation(api.settings.updateOrganisation, organisation);

    const saved = await admin.as.query(api.settings.getOrganisation, {});
    expect(saved).toMatchObject({
      legalName: 'Unbuilt Studio Ltd',
      addressLines: ['12 Example Street', 'Lagos'],
      brand: { primary: '#000000', accent: '#FFC400' },
    });
    expect(saved.vatNumber).toBeUndefined();
    // The contact details documents and invoices print are normalised on the way in.
    expect(saved).toMatchObject({
      email: 'hello@unbuilt.studio',
      phone: '+2348012345678',
      website: 'https://unbuilt.studio',
    });
    const audit = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(audit).toEqual([expect.objectContaining({ table: 'orgSettings', permission: 'settings.manage' })]);
  });

  it.each([
    ['a country that is not an ISO code', { country: 'Nigeria' }],
    ['an unknown timezone', { timezone: 'Lagos/Island' }],
    ['a retention period under a year', { retentionYears: 0 }],
    ['a colour that is not hex', { brand: { primary: 'black', accent: '#FFC400' } }],
    ['an email address that is not one', { email: 'hello at unbuilt' }],
    ['a phone number that is not international', { phone: '0801 234 5678' }],
    ['a website with no domain', { website: 'unbuilt' }],
  ])('rejects %s', async (_, override) => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    await expectCode(
      admin.as.mutation(api.settings.updateOrganisation, { ...organisation, ...override }),
      'settings.invalid',
    );
  });

  it('requires settings.manage', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(finance.as.query(api.settings.getOrganisation, {}), 'auth.forbidden');
    await expectCode(finance.as.mutation(api.settings.updateOrganisation, organisation), 'auth.forbidden');
    await expectCode(client.as.query(api.settings.getOrganisation, {}), 'auth.forbidden');
    await expectCode(t.query(api.settings.getOrganisation, {}), 'auth.unauthenticated');
  });
});

describe('billing settings', () => {
  it('lets Finance read and save them, redacting bank accounts in the audit log', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    await finance.as.mutation(api.settings.updateBilling, billing);

    const view = await finance.as.query(api.settings.getBilling, {});
    expect(view.bankAccounts).toEqual([expect.objectContaining({ accountNumber: '0123456789' })]);
    expect(view.numbering.invoice).toEqual({ prefix: 'INV', padding: 5 });
    expect(view.numbering.receipt).toEqual({ prefix: 'UNB-RCT-', padding: 4 });

    const updates = await t.run((ctx) =>
      ctx.db
        .query('auditLog')
        .withIndex('by_target', (q) => q.eq('table', 'orgSettings'))
        .collect(),
    );
    const update = updates.find((entry) => entry.action === 'update')!;
    expect(update.diff.after.bankAccounts).toBe(REDACTED);
    expect(JSON.stringify(updates)).not.toContain('0123456789');
  });

  it('applies the configured numbering to new records', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    await finance.as.mutation(api.settings.updateBilling, billing);
    const numbers = await t.run(async (ctx) => [await nextNumber(ctx, 'invoice'), await nextNumber(ctx, 'quote')]);
    expect(numbers).toEqual(['INV00001', 'UNB-QUO-0001']);
  });

  it.each([
    ['VAT over 100%', { defaultVatBps: 10_001 }, 'money.invalid'],
    ['an unknown numbered record', { numbering: { payslip: { prefix: 'PAY', padding: 4 } } }, 'settings.invalid'],
    ['a prefix with spaces', { numbering: { invoice: { prefix: 'IN V', padding: 4 } } }, 'settings.invalid'],
    ['padding of zero', { numbering: { invoice: { prefix: 'INV', padding: 0 } } }, 'settings.invalid'],
    ['negative payment terms', { defaultPaymentTermsDays: -1 }, 'settings.invalid'],
    [
      'a bank account without a number',
      { bankAccounts: [{ ...billing.bankAccounts[0], accountNumber: '  ' }] },
      'settings.invalid',
    ],
  ])('rejects %s', async (_, override, code) => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    await expectCode(finance.as.mutation(api.settings.updateBilling, { ...billing, ...override }), code);
  });

  it('requires settings.billing.sensitive', async () => {
    const pm = await createTeamMember(t, roles.project_manager, { email: 'pm@unbuilt.studio' });
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(pm.as.query(api.settings.getBilling, {}), 'auth.forbidden');
    await expectCode(pm.as.mutation(api.settings.updateBilling, billing), 'auth.forbidden');
    await expectCode(client.as.query(api.settings.getBilling, {}), 'auth.forbidden');
  });
});

describe('abandoned uploads', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const upload = () => t.run((ctx) => ctx.storage.store(new Blob([png], { type: 'image/png' })));

  it('keeps uploads younger than a day', async () => {
    const recent = await upload();
    expect(await t.mutation(internal.files.cleanupOrphanUploads, {})).toEqual({ deleted: 0 });
    expect(await t.run((ctx) => ctx.db.system.get('_storage', recent))).not.toBeNull();
  });

  it('deletes old uploads that were never recorded and keeps recorded files', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const abandoned = await upload();
    const kept = await upload();
    await admin.as.mutation(api.settings.setLogo, { storageId: kept, name: 'logo.png', contentType: 'image/png' });

    expect(await t.mutation(internal.files.cleanupOrphanUploads, { minAgeMs: 0 })).toEqual({ deleted: 1 });
    expect(await t.run((ctx) => ctx.db.system.get('_storage', abandoned))).toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get('_storage', kept))).not.toBeNull();
  });
});

describe('logo and file downloads', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const store = (bytes: Uint8Array<ArrayBuffer>, type: string) =>
    t.run((ctx) => ctx.storage.store(new Blob([bytes], { type }))) as Promise<Id<'_storage'>>;
  const logo = async (as: { mutation: TestConvex['mutation'] }, name = 'logo.png') => {
    const result = await as.mutation(api.settings.setLogo, {
      storageId: await store(PNG, 'image/png'),
      name,
      contentType: 'image/png',
    });
    if (!result?.ok) throw new Error(`Upload failed: ${JSON.stringify(result)}`);
    return result.fileId;
  };
  const hex = async (bytes: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  const pathOf = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  };

  it('reads the logo’s pixel size from its header, so a page can reserve the space', async () => {
    // A real 7 by 3 PNG, not a signature with bytes after it: the point is that the header is genuinely parsed.
    const real = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAIAAADQoYKSAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAA' +
          'GgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAB6ADAAQAAAABAAAAAwAAAAAk1nmWAAAAQ0lEQVQIHRWKoREAMQjAoH9XjhEQ' +
          'VUzQYVkNjWMBBPJpZJIPAIjonMPMVYWIYx733sx0dzNT1TGvzCsia629d0R09w/YRRFdE+YUoQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const result = await admin.as.mutation(api.settings.setLogo, {
      storageId: await store(real, 'image/png'),
      name: 'logo.png',
      contentType: 'image/png',
    });
    if (!result?.ok) throw new Error('Upload failed');

    // Measuring follows the upload as its own step, because a mutation cannot read the bytes.
    expect(await t.run((ctx) => ctx.db.get('files', result.fileId))).not.toHaveProperty('width');
    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(await t.run((ctx) => ctx.db.get('files', result.fileId))).toMatchObject({ width: 7, height: 3 });
  });

  it('records no size for an image it cannot read, and keeps the file', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const fileId = await logo(admin.as);
    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    // PNG here is a signature with junk after it: unreadable, and that is not a reason to lose the upload.
    const file = await t.run((ctx) => ctx.db.get('files', fileId));
    expect(file).not.toHaveProperty('width');
    expect(file).not.toBeNull();
  });

  it('uploads a logo, records its hash, and serves it through a signed link', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    expect(await admin.as.mutation(api.settings.generateLogoUploadUrl, {})).toMatch(/^https?:\/\//);

    const storageId = await store(PNG, 'image/png');
    const result = await admin.as.mutation(api.settings.setLogo, {
      storageId,
      name: 'Unbuilt mark.png',
      contentType: 'image/png',
    });
    const fileId = result!.ok ? result.fileId : expect.fail('upload rejected');
    const file = await t.run((ctx) => ctx.db.get('files', fileId));
    expect(file).toMatchObject({
      name: 'Unbuilt mark.png',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      sha256: await hex(PNG),
      owner: { table: 'orgSettings' },
      visibility: 'internal',
      uploadedByKind: 'team',
    });
    expect((await admin.as.query(api.settings.getOrganisation, {})).logoFileId).toBe(fileId);

    // Any team member may download the logo; the link carries no storage id.
    const member = await createTeamMember(t, roles.member, { email: 'member@unbuilt.studio' });
    const { url } = await member.as.query(api.files.teamDownloadUrl, { fileId });
    expect(url).not.toContain(storageId);
    const response = await t.fetch(pathOf(url));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('rejects a file that breaks the rules and deletes what was uploaded', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const pdf = await store(new TextEncoder().encode('%PDF-1.7'), 'application/pdf');
    expect(
      await admin.as.mutation(api.settings.setLogo, {
        storageId: pdf,
        name: 'logo.pdf',
        contentType: 'application/pdf',
      }),
    ).toMatchObject({ ok: false, code: 'files.typeNotAllowed' });
    expect(await t.run((ctx) => ctx.db.system.get('_storage', pdf))).toBeNull();

    // A page renamed to look like an image is refused too.
    const disguised = await store(new TextEncoder().encode('<script>'), 'image/png');
    expect(
      await admin.as.mutation(api.settings.setLogo, {
        storageId: disguised,
        name: 'logo.html',
        contentType: 'image/png',
      }),
    ).toMatchObject({ ok: false, code: 'files.typeMismatch' });

    expect(await t.run((ctx) => ctx.db.query('files').collect())).toEqual([]);
    expect((await admin.as.query(api.settings.getOrganisation, {})).logoFileId).toBeUndefined();
  });

  it('replaces the logo and deletes the old file and its bytes', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const firstId = await logo(admin.as, 'one.png');
    const first = (await t.run((ctx) => ctx.db.get('files', firstId)))!.storageId;
    await logo(admin.as, 'two.png');

    expect(await t.run((ctx) => ctx.db.get('files', firstId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get('_storage', first))).toBeNull();
    await admin.as.mutation(api.settings.removeLogo, {});
    expect(await t.run((ctx) => ctx.db.query('files').collect())).toEqual([]);
  });

  it('refuses logo changes without settings.manage', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    const storageId = await store(PNG, 'image/png');
    await expectCode(finance.as.mutation(api.settings.generateLogoUploadUrl, {}), 'auth.forbidden');
    await expectCode(
      finance.as.mutation(api.settings.setLogo, { storageId, name: 'logo.png', contentType: 'image/png' }),
      'auth.forbidden',
    );
    await expectCode(finance.as.mutation(api.settings.removeLogo, {}), 'auth.forbidden');
  });

  it('never hands a download link to someone who may not read the file, even with its id', async () => {
    const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
    const fileId = await logo(admin.as);
    const glossup = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });

    await expectCode(glossup.as.query(api.files.teamDownloadUrl, { fileId }), 'auth.forbidden');
    await expectCode(glossup.as.query(api.files.portalDownloadUrl, { fileId }), 'auth.notFound');
    await expectCode(t.query(api.files.teamDownloadUrl, { fileId }), 'auth.unauthenticated');

    // A client-visible file owned by a table with no access rule is readable by nobody.
    const orphan = await t.run(async (ctx) =>
      ctx.db.insert('files', {
        storageId: await ctx.storage.store(new Blob([PNG], { type: 'image/png' })),
        name: 'x.png',
        mimeType: 'image/png',
        sizeBytes: PNG.length,
        sha256: 'x',
        owner: { table: 'contacts', id: glossup.contactId },
        clientId: glossup.clientId,
        visibility: 'client',
        uploadedByKind: 'team',
        uploadedById: 'x',
      }),
    );
    await expectCode(glossup.as.query(api.files.portalDownloadUrl, { fileId: orphan }), 'auth.notFound');
    await expectCode(admin.as.query(api.files.teamDownloadUrl, { fileId: orphan }), 'auth.notFound');
  });

  it('refuses tampered or expired links and removed files', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const admin = await createTeamMember(t, roles.admin, { email: 'admin@unbuilt.studio' });
      const fileId = await logo(admin.as);
      const { url, expiresAt } = await admin.as.query(api.files.teamDownloadUrl, { fileId });

      const tampered = new URL(url);
      tampered.searchParams.set('signature', 'f'.repeat(64));
      expect((await t.fetch(pathOf(tampered.toString()))).status).toBe(403);

      await admin.as.mutation(api.settings.removeLogo, {});
      expect((await t.fetch(pathOf(url))).status).toBe(404);

      vi.setSystemTime(expiresAt + 1);
      expect((await t.fetch(pathOf(url))).status).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });
});
