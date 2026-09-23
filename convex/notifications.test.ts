import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './_generated/api';
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
  t = newTest();
  roles = await seedRoles(t);
});

const notify = (recipientKind: 'team' | 'client', recipientId: string, title: string, extra: object = {}) =>
  t.run((ctx) =>
    ctx.db.insert('notifications', {
      recipientKind,
      recipientId,
      event: 'test',
      title,
      body: `${title} body`,
      channels: { inApp: true },
      createdAt: Date.now(),
      ...extra,
    }),
  );

describe('team notifications', () => {
  it('list only the caller’s own, newest first, with an unread count', async () => {
    const dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    const kemi = await createTeamMember(t, roles.finance, { email: 'kemi@unbuilt.studio' });
    await notify('team', dayo.memberId, 'Older', { createdAt: 1_000 });
    await notify('team', dayo.memberId, 'Newer', { createdAt: 2_000, readAt: 2_500 });
    await notify('team', kemi.memberId, 'Not yours');
    // A contact id that happens to be addressed as a team recipient never matches a member.
    await notify('client', dayo.memberId, 'Wrong surface');

    const result = await dayo.as.query(api.notifications.teamList, {});
    expect(result.items.map((item) => item.title)).toEqual(['Newer', 'Older']);
    expect(result.items.map((item) => item.read)).toEqual([true, false]);
    expect(result.unreadCount).toBe(1);
  });

  it('drop links that are not in-app paths', async () => {
    const dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    await notify('team', dayo.memberId, 'Safe', { link: '/billing/invoices/1', createdAt: 2 });
    await notify('team', dayo.memberId, 'Unsafe', { link: 'https://evil.example', createdAt: 1 });
    const { items } = await dayo.as.query(api.notifications.teamList, {});
    expect(items.map((item) => item.link)).toEqual(['/billing/invoices/1', undefined]);
  });

  it('mark one as read, audited, and refuse someone else’s', async () => {
    const dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    const kemi = await createTeamMember(t, roles.admin, { email: 'kemi@unbuilt.studio' });
    const mine = await notify('team', dayo.memberId, 'Mine');
    const theirs = await notify('team', kemi.memberId, 'Theirs');

    await dayo.as.mutation(api.notifications.teamMarkRead, { notificationId: mine });
    await expectCode(dayo.as.mutation(api.notifications.teamMarkRead, { notificationId: theirs }), 'auth.notFound');

    expect((await t.run((ctx) => ctx.db.get('notifications', mine)))?.readAt).toBeTypeOf('number');
    expect((await t.run((ctx) => ctx.db.get('notifications', theirs)))?.readAt).toBeUndefined();
    const audit = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(audit).toEqual([
      expect.objectContaining({ actorId: dayo.memberId, table: 'notifications', action: 'update' }),
    ]);
  });

  it('mark all of the caller’s own as read and nobody else’s', async () => {
    const dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    const kemi = await createTeamMember(t, roles.member, { email: 'kemi@unbuilt.studio' });
    await notify('team', dayo.memberId, 'One');
    await notify('team', dayo.memberId, 'Two');
    await notify('team', kemi.memberId, 'Theirs');

    await dayo.as.mutation(api.notifications.teamMarkAllRead, {});
    expect((await dayo.as.query(api.notifications.teamList, {})).unreadCount).toBe(0);
    expect((await kemi.as.query(api.notifications.teamList, {})).unreadCount).toBe(1);
  });

  it('reject callers who are not active team members with 2FA', async () => {
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    const noTwoFactor = await createTeamMember(
      t,
      roles.admin,
      { email: 'new@unbuilt.studio' },
      { twoFactorEnabled: false },
    );
    await expectCode(t.query(api.notifications.teamList, {}), 'auth.unauthenticated');
    await expectCode(client.as.query(api.notifications.teamList, {}), 'auth.forbidden');
    await expectCode(client.as.mutation(api.notifications.teamMarkAllRead, {}), 'auth.forbidden');
    await expectCode(noTwoFactor.as.query(api.notifications.teamList, {}), 'auth.twoFactorRequired');
  });
});

describe('the bell', () => {
  it('holds the latest ten, however many there are', async () => {
    const dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    for (let i = 1; i <= 14; i++) await notify('team', dayo.memberId, `Notice ${i}`, { createdAt: 1_000 + i });
    const bell = await dayo.as.query(api.notifications.teamList, {});
    expect(bell.items).toHaveLength(10);
    expect(bell.items[0].title).toBe('Notice 14');
    expect(bell.unreadCount).toBe(14);
  });
});

describe('the full list', () => {
  it('pages through, oldest last, and can show only the unread', async () => {
    const dayo = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    const kemi = await createTeamMember(t, roles.finance, { email: 'kemi@unbuilt.studio' });
    // 35 of Dayo's, the oldest first, so the newest is "Notice 35".
    for (let i = 1; i <= 35; i++) {
      await notify('team', dayo.memberId, `Notice ${i}`, {
        createdAt: 1_000 + i,
        ...(i > 30 ? {} : { readAt: 2_000 }),
      });
    }
    await notify('team', kemi.memberId, 'Not yours');

    const first = await dayo.as.query(api.notifications.teamFeed, {});
    expect(first.items).toHaveLength(30);
    expect(first.items[0].title).toBe('Notice 35');
    expect(first.unreadCount).toBe(5);
    expect(first.nextBefore).toBeDefined();

    const second = await dayo.as.query(api.notifications.teamFeed, { before: first.nextBefore });
    expect(second.items.map((item) => item.title)).toEqual([
      'Notice 5',
      'Notice 4',
      'Notice 3',
      'Notice 2',
      'Notice 1',
    ]);
    expect(second.nextBefore).toBeUndefined();
    expect(second.items.some((item) => item.title === 'Not yours')).toBe(false);

    const unread = await dayo.as.query(api.notifications.teamFeed, { unreadOnly: true });
    expect(unread.items.map((item) => item.title)).toEqual([
      'Notice 35',
      'Notice 34',
      'Notice 33',
      'Notice 32',
      'Notice 31',
    ]);
  });

  it('is each client’s own in the portal', async () => {
    const ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    const bola = await createClientUser(t, roles.client_admin, { clientName: 'Other', email: 'bola@other.com' });
    await notify('client', ada.contactId, 'Ada’s');
    await notify('client', bola.contactId, 'Bola’s');
    const mine = await ada.as.query(api.notifications.portalFeed, {});
    expect(mine.items.map((item) => item.title)).toEqual(['Ada’s']);
  });
});

describe('portal notifications with two clients', () => {
  it('each client user sees and changes only their own', async () => {
    const ada = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    const tunde = await createClientUser(t, roles.client_member, { clientName: 'Qravit', email: 'tunde@qravit.io' });
    const adas = await notify('client', ada.contactId, 'For Ada');
    await notify('client', tunde.contactId, 'For Tunde');

    expect((await ada.as.query(api.notifications.portalList, {})).items.map((item) => item.title)).toEqual(['For Ada']);
    expect((await tunde.as.query(api.notifications.portalList, {})).items.map((item) => item.title)).toEqual([
      'For Tunde',
    ]);

    await expectCode(tunde.as.mutation(api.notifications.portalMarkRead, { notificationId: adas }), 'auth.notFound');
    await tunde.as.mutation(api.notifications.portalMarkAllRead, {});
    expect((await ada.as.query(api.notifications.portalList, {})).unreadCount).toBe(1);
  });

  it('reject team members and signed-out callers', async () => {
    const owner = await createTeamMember(t, roles.owner, { email: 'owner@unbuilt.studio' });
    await expectCode(owner.as.query(api.notifications.portalList, {}), 'auth.forbidden');
    await expectCode(owner.as.mutation(api.notifications.portalMarkAllRead, {}), 'auth.forbidden');
    await expectCode(t.query(api.notifications.portalList, {}), 'auth.unauthenticated');
  });
});

describe('auth.viewer', () => {
  it('returns the role’s permissions for navigation, and none without a principal', async () => {
    const finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
    const viewer = await finance.as.query(api.auth.viewer, {});
    expect(viewer.principal).toEqual({ kind: 'team', name: 'finance@unbuilt.studio', roleName: 'Finance' });
    expect(viewer.permissions).toContain('invoices.send');
    expect(viewer.permissions).not.toContain('clients.delete');

    const suspended = await createTeamMember(t, roles.admin, { email: 'gone@unbuilt.studio', status: 'suspended' });
    expect(await suspended.as.query(api.auth.viewer, {})).toMatchObject({ principal: null, permissions: [] });
  });
});
