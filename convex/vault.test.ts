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
  const submit = async (as: typeof ada, overrides: object = {}) =>
    await as.as.action(api.vault.submitFromPortal, {
      label: 'Analytics login',
      kind: 'login',
      secret: 'client-typed-this',
      ...overrides,
    });

  it('has its submission encrypted before anything writes it down', async () => {
    const itemId = await submit(ada);
    const stored = await t.run((ctx) => ctx.db.get('vaultItems', itemId));
    expect(JSON.stringify(stored)).not.toContain('client-typed-this');
    expect(stored).toMatchObject({ submittedByKind: 'client', submittedById: ada.contactId, clientId });
  });

  it('is not offered the studio’s vault queries at all', async () => {
    await addItem();
    await expectCode(ada.as.query(api.vaultData.list, { clientId }), 'auth.forbidden');
  });

  it('sees its own submissions as labels and dates, and nothing the studio holds', async () => {
    await addItem({ label: 'Hosting login' });
    await submit(ada, { label: 'Analytics login' });
    const listed = await ada.as.query(api.vaultData.portalList, {});
    expect(listed.map((item) => item.label)).toEqual(['Analytics login']);
    // Not even the shape hints at a value, so there is nothing to ask for. Checked as "no key outside this set"
    // rather than an exact list, because Convex omits a field that was never given one.
    const allowed = ['id', 'label', 'kind', 'url', 'submittedAt', 'status'];
    expect(Object.keys(listed[0]).filter((key) => !allowed.includes(key))).toEqual([]);
  });

  it('cannot submit into another client, and cannot see what they submitted', async () => {
    const bello = await createClientUser(t, roles.client_admin, { clientName: 'Bello Foods', email: 'b@bello.com' });
    await submit(ada, { label: 'Ada’s analytics' });
    await submit(bello, { label: 'Bello’s analytics' });

    // There is no clientId argument to aim at another client, so the only question is what each one is given back.
    const theirs = await bello.as.query(api.vaultData.portalList, {});
    expect(theirs.map((item) => item.label)).toEqual(['Bello’s analytics']);
    const stored = await t.run((ctx) => ctx.db.query('vaultItems').collect());
    expect(stored.find((item) => item.label === 'Bello’s analytics')!.clientId).toBe(bello.clientId);
  });

  it('refuses a client whose role cannot submit', async () => {
    // Both seeded portal roles may submit, so the role that may not has to be made here.
    const readOnly = await t.run((ctx) =>
      ctx.db.insert('roles', {
        key: 'custom_portal_reader',
        name: 'Portal reader',
        kind: 'client',
        permissions: ['portal.projects.view'],
        isSystem: false,
        description: '',
      }),
    );
    const viewer = await createClientUser(t, readOnly, { clientName: 'Quiet Co', email: 'q@quiet.com' });
    await expectCode(submit(viewer), 'auth.forbidden');
  });
});

describe('editing an item', () => {
  it('changes what a list shows, without touching the secret', async () => {
    const itemId = await addItem();
    await pm.as.mutation(api.vaultData.update, { itemId, label: 'Hosting login (Vercel)', url: 'https://vercel.com' });
    const one = await pm.as.query(api.vaultData.get, { itemId });
    expect(one).toMatchObject({ label: 'Hosting login (Vercel)', url: 'https://vercel.com' });
    // The secret is untouched by a metadata edit, which is the only way to know the edit went nowhere near it.
    expect((await pm.as.action(api.vault.reveal, { itemId })).secret).toBe(SECRET);
  });

  it('refuses to move an item to another client’s project', async () => {
    const itemId = await addItem();
    const other = await createClientUser(t, roles.client_admin, { clientName: 'Bello', email: 'b@bello.com' });
    const theirProject = await pm.as.mutation(api.projects.create, {
      clientId: other.clientId,
      name: 'Bello site',
      type: 'web_platform',
      billingModel: 'fixed',
      currency: 'NGN',
      startDate: '2026-09-01',
    });
    await expectCode(pm.as.mutation(api.vaultData.update, { itemId, projectId: theirProject }), 'vault.invalid');
  });

  it('will not let somebody edit an item they could not reveal', async () => {
    const itemId = await addItem();
    // A role with vault.manage still only reaches the items its view permission reaches.
    const manager = await createTeamMember(t, roles.project_manager, { email: 'other@unbuilt.studio', name: 'Other' });
    await t.run(async (ctx) => {
      const item = (await ctx.db.query('vaultItems').collect())[0];
      await ctx.db.patch('vaultItems', item._id, { projectId: undefined });
    });
    await expectCode(manager.as.mutation(api.vaultData.update, { itemId, label: 'Renamed' }), 'vault.notFound');
  });

  it('replaces the secret on a rotation and records who did it', async () => {
    const itemId = await addItem({ rotateByDate: '2026-11-01' });
    await pm.as.action(api.vault.updateSecret, {
      itemId,
      secret: 'a-brand-new-secret',
      username: 'ops@unbuilt.studio',
    });

    const revealed = await pm.as.action(api.vault.reveal, { itemId });
    expect(revealed.secret).toBe('a-brand-new-secret');
    expect(revealed.username).toBe('ops@unbuilt.studio');
    const stored = await t.run((ctx) => ctx.db.get('vaultItems', itemId));
    expect(stored).toMatchObject({ lastRotatedByMemberId: pm.memberId, lastRotatedAt: Date.now() });
    // The old ciphertext is gone, and the rotation date it satisfied is cleared rather than left to fire again.
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(stored).not.toHaveProperty('rotateByDate');
  });
});

describe('handover, archiving and deleting', () => {
  it('takes an archived item out of the list and lets it back in', async () => {
    const itemId = await addItem();
    await pm.as.mutation(api.vaultData.setStatus, { itemId, status: 'archived' });
    expect(await pm.as.query(api.vaultData.list, { clientId })).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get('vaultItems', itemId)))!.archivedAt).toBe(Date.now());

    await pm.as.mutation(api.vaultData.setStatus, { itemId, status: 'active' });
    expect(await pm.as.query(api.vaultData.list, { clientId })).toHaveLength(1);
  });

  it('refuses to edit an archived item until it is restored', async () => {
    const itemId = await addItem();
    await pm.as.mutation(api.vaultData.setStatus, { itemId, status: 'archived' });
    await expectCode(pm.as.mutation(api.vaultData.update, { itemId, label: 'Renamed' }), 'vault.archived');
    await expectCode(pm.as.action(api.vault.updateSecret, { itemId, secret: 'new' }), 'vault.archived');
  });

  it('marks an item handed over without destroying it', async () => {
    const itemId = await addItem();
    await pm.as.mutation(api.vaultData.setStatus, { itemId, status: 'handed_over' });
    expect((await pm.as.query(api.vaultData.get, { itemId }))!.status).toBe('handed_over');
    // Handed over is a statement about who holds it now, not an instruction to forget it.
    expect((await pm.as.action(api.vault.reveal, { itemId })).secret).toBe(SECRET);
  });

  it('keeps the access log when the item is deleted', async () => {
    const itemId = await addItem();
    await pm.as.action(api.vault.reveal, { itemId });
    await pm.as.mutation(api.vaultData.remove, { itemId });

    expect(await t.run((ctx) => ctx.db.get('vaultItems', itemId))).toBeNull();
    // The record of who saw this credential outlives the credential.
    const kept = await logs();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ action: 'reveal', vaultItemId: itemId });
  });
});

describe('when somebody comes off a project', () => {
  it('asks the manager to rotate what that person had revealed', async () => {
    const itemId = await addItem({ label: 'Hosting login' });
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: member.memberId });
    await pm.as.action(api.vault.reveal, { itemId });
    await member.as.action(api.vault.reveal, { itemId });

    await pm.as.mutation(api.projects.removeProjectMember, { projectId, memberId: member.memberId });
    const notifications = await t.run((ctx) =>
      ctx.db
        .query('notifications')
        .filter((q) => q.eq(q.field('event'), 'vault.rotation.afterLeaving'))
        .collect(),
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ recipientId: pm.memberId });
    expect(notifications[0].title).toBe('Rotate 1 credential on Glossup app');
    expect(notifications[0].body).toContain('Hosting login');
    // Never the value itself, in the one place a secret would be easiest to leak by accident.
    expect(JSON.stringify(notifications)).not.toContain(SECRET);
  });

  it('says nothing when they never revealed anything', async () => {
    await addItem();
    await pm.as.mutation(api.projects.addProjectMember, { projectId, memberId: member.memberId });
    await pm.as.mutation(api.projects.removeProjectMember, { projectId, memberId: member.memberId });
    const notifications = await t.run((ctx) =>
      ctx.db
        .query('notifications')
        .filter((q) => q.eq(q.field('event'), 'vault.rotation.afterLeaving'))
        .collect(),
    );
    // A prompt for credentials nobody looked at is how a prompt starts being ignored.
    expect(notifications).toHaveLength(0);
  });
});

describe('the audit log', () => {
  const auditReads = async () =>
    (await t.run((ctx) => ctx.db.query('auditLog').collect())).filter((row) => row.table === 'vaultItems');

  it('records one entry for a reveal and one for a copy, alongside the access log', async () => {
    const itemId = await addItem();
    const beforeReveal = (await auditReads()).length;
    await pm.as.action(api.vault.reveal, { itemId });
    const afterReveal = await auditReads();
    expect(afterReveal).toHaveLength(beforeReveal + 1);
    expect(afterReveal.at(-1)).toMatchObject({ action: 'read', recordId: itemId, actorId: pm.memberId });

    await pm.as.action(api.vault.recordCopy, { itemId });
    expect(await auditReads()).toHaveLength(beforeReveal + 2);
  });

  it('keeps a refusal out of the audit log, where the access log already has it', async () => {
    const itemId = await addItem();
    const before = (await auditReads()).length;
    await expectCode(member.as.action(api.vault.reveal, { itemId }), 'vault.notFound');
    expect(await auditReads()).toHaveLength(before);
    expect(await logs()).toHaveLength(1);
  });

  it('never carries a secret in a diff, however the item was written', async () => {
    await addItem({ notes: 'the recovery codes are in the safe' });
    const all = await t.run((ctx) => ctx.db.query('auditLog').collect());
    const asText = JSON.stringify(all);
    expect(asText).not.toContain(SECRET);
    expect(asText).not.toContain('recovery codes');
    expect(asText).not.toContain('studio@unbuilt.studio');
  });
});
