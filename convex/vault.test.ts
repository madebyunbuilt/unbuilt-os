import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// The credentials vault (10-vault.md). The promise it makes is narrow and absolute: what is written down cannot be
// read without a key, only somebody entitled may ask for it, and every asking is on the record.

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

const SECRET = 'correct-horse-battery-staple';

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let member: Awaited<ReturnType<typeof createTeamMember>>;
let ada: Awaited<ReturnType<typeof createClientUser>>;
let clientId: Id<'clients'>;
let projectId: Id<'projects'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
  vi.stubEnv('VAULT_KEY_v1', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('VAULT_ACTIVE_KEY_VERSION', '1');
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  member = await createTeamMember(t, roles.member, { email: 'segun@unbuilt.studio', name: 'Segun Cole' });
  ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  clientId = ada.clientId;
  projectId = await pm.as.mutation(api.projects.create, {
    clientId,
    name: 'Glossup app',
    type: 'mobile_app',
    billingModel: 'fixed',
    currency: 'NGN',
    startDate: '2026-09-01',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const addItem = async (overrides: object = {}) =>
  await pm.as.action(api.vault.create, {
    clientId,
    projectId,
    label: 'Hosting login',
    kind: 'login',
    username: 'studio@unbuilt.studio',
    secret: SECRET,
    ...overrides,
  });

const logs = async () => await t.run((ctx) => ctx.db.query('vaultAccessLogs').collect());

describe('what reaches the database', () => {
  it('holds no plaintext secret anywhere in the document', async () => {
    const itemId = await addItem({ notes: 'the recovery codes are in the safe' });
    const stored = await t.run((ctx) => ctx.db.get('vaultItems', itemId));
    const asText = JSON.stringify(stored);
    // The whole point of the module, checked the way the spec asks: scan the stored document.
    expect(asText).not.toContain(SECRET);
    expect(asText).not.toContain('studio@unbuilt.studio');
    expect(asText).not.toContain('recovery codes');
    expect(stored!.secretCiphertext.length).toBeGreaterThan(0);
    expect(stored!.keyVersion).toBe(1);
  });

  it('keeps the label and the URL readable, so items can be listed without a key', async () => {
    const itemId = await addItem({ url: 'https://hosting.example.com' });
    const stored = await t.run((ctx) => ctx.db.get('vaultItems', itemId));
    expect(stored).toMatchObject({ label: 'Hosting login', url: 'https://hosting.example.com', kind: 'login' });
  });

  it('never returns a secret from a query', async () => {
    const itemId = await addItem();
    const listed = await pm.as.query(api.vaultData.list, { clientId });
    const one = await pm.as.query(api.vaultData.get, { itemId });
    for (const shape of [listed, one]) {
      expect(JSON.stringify(shape)).not.toContain(SECRET);
    }
    // It says a username exists without saying what it is.
    expect(one).toMatchObject({ hasUsername: true, label: 'Hosting login' });
  });

  it('refuses an item with nothing in it', async () => {
    await expectCode(addItem({ secret: '   ' }), 'vault.invalid');
  });
});

describe('revealing one', () => {
  it('gives back exactly what was put in', async () => {
    const itemId = await addItem({ notes: 'rotate after handover' });
    const value = await pm.as.action(api.vault.reveal, { itemId });
    expect(value).toMatchObject({
      secret: SECRET,
      username: 'studio@unbuilt.studio',
      notes: 'rotate after handover',
    });
    // The screen is told how long to show it for, rather than deciding on its own.
    expect(value.hideAfterMs).toBe(30_000);
  });

  it('writes exactly one access log for each reveal', async () => {
    const itemId = await addItem();
    await pm.as.action(api.vault.reveal, { itemId });
    expect(await logs()).toHaveLength(1);
    expect((await logs())[0]).toMatchObject({ action: 'reveal', memberId: pm.memberId });

    await pm.as.action(api.vault.reveal, { itemId });
    expect(await logs()).toHaveLength(2);
    // And the item remembers it was seen.
    expect((await t.run((ctx) => ctx.db.get('vaultItems', itemId)))!.lastRevealedAt).toBe(Date.now());
  });

  it('logs a copy as its own kind of access', async () => {
    const itemId = await addItem();
    await pm.as.action(api.vault.recordCopy, { itemId });
    const [log] = await logs();
    expect(log).toMatchObject({ action: 'copy', memberId: pm.memberId });
    // Copying is not revealing: it must not move the last-seen time.
    expect((await t.run((ctx) => ctx.db.get('vaultItems', itemId)))!.lastRevealedAt).toBeUndefined();
  });

  it('refuses somebody not on the project, and writes down that they asked', async () => {
    const itemId = await addItem();
    await expectCode(member.as.action(api.vault.reveal, { itemId }), 'vault.notFound');
    const [log] = await logs();
    expect(log).toMatchObject({ action: 'refused', memberId: member.memberId, reason: 'not on this project' });
  });

  it('lets somebody on the project see it', async () => {
    const itemId = await addItem();
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: member.memberId });
    expect((await member.as.action(api.vault.reveal, { itemId })).secret).toBe(SECRET);
  });

  it('refuses an item held against the client as a whole to somebody with only project scope', async () => {
    const itemId = await addItem({ projectId: undefined });
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: member.memberId });
    // There is no project membership to stand on, so being on every project would still not be enough.
    await expectCode(member.as.action(api.vault.reveal, { itemId }), 'vault.notFound');
    expect((await logs())[0]).toMatchObject({ reason: 'not on a project' });
  });

  it('refuses a role with no vault permission at all, and says so in the log', async () => {
    const itemId = await addItem();
    const finance = await createTeamMember(t, roles.finance, { email: 'zainab@unbuilt.studio', name: 'Zainab B' });
    await expectCode(finance.as.action(api.vault.reveal, { itemId }), 'vault.notFound');
    expect((await logs())[0]).toMatchObject({ reason: 'no vault permission' });
  });
});

describe('the second factor', () => {
  it('will not reveal on a session whose check has gone stale', async () => {
    const itemId = await addItem();
    // Signing in as a team member proved a second factor; sixteen minutes later that no longer counts.
    vi.setSystemTime(Date.parse('2026-10-12T09:16:00Z'));
    await expectCode(pm.as.action(api.vault.reveal, { itemId }), 'vault.twoFactorRequired');
    expect((await logs())[0]).toMatchObject({ action: 'refused', reason: 'second factor too old' });
  });

  it('reveals again once the code has been entered afresh', async () => {
    const itemId = await addItem();
    vi.setSystemTime(Date.parse('2026-10-12T09:16:00Z'));
    await expectCode(pm.as.action(api.vault.reveal, { itemId }), 'vault.twoFactorRequired');

    await t.mutation(internal.vaultData.recordTwoFactorCheck, {
      sessionId: pm.sessionId,
      memberId: pm.memberId,
    });
    expect((await pm.as.action(api.vault.reveal, { itemId })).secret).toBe(SECRET);
  });
});

describe('what a client may do', () => {
  it('has its submission encrypted before anything writes it down', async () => {
    const itemId = await t.action(internal.vault.submitFromPortal, {
      clientId,
      label: 'Analytics login',
      kind: 'login',
      secret: 'client-typed-this',
      contactId: ada.contactId,
    });
    const stored = await t.run((ctx) => ctx.db.get('vaultItems', itemId));
    expect(JSON.stringify(stored)).not.toContain('client-typed-this');
    expect(stored).toMatchObject({ submittedByKind: 'client', submittedById: ada.contactId });
  });

  it('is not offered the studio’s vault queries at all', async () => {
    await addItem();
    await expectCode(ada.as.query(api.vaultData.list, { clientId }), 'auth.forbidden');
  });
});
