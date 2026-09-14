import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type seedRoles, type TestConvex } from './test.auth';

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
let admin: Awaited<ReturnType<typeof createTeamMember>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let finance: Awaited<ReturnType<typeof createTeamMember>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-14T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) => {
    const byKey = async (key: string) =>
      (await ctx.db
        .query('roles')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique())!._id;
    return {
      admin: await byKey('admin'),
      project_manager: await byKey('project_manager'),
      finance: await byKey('finance'),
      member: await byKey('member'),
      client_admin: await byKey('client_admin'),
    } as Awaited<ReturnType<typeof seedRoles>>;
  });
  admin = await createTeamMember(t, roles.admin, { email: 'kemi@unbuilt.studio', name: 'Kemi Bello' });
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio' });
  finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio' });
});

afterEach(() => {
  vi.useRealTimers();
});

const holidayNamed = async (year: number, name: string) => {
  const { holidays } = await admin.as.query(api.holidays.list, { year });
  return holidays.find((holiday) => holiday.name === name)!;
};

describe('holidays', () => {
  it('shows holidays to settings.manage and sla.manage, editable only with settings.manage', async () => {
    const forAdmin = await admin.as.query(api.holidays.list, { year: 2026 });
    expect(forAdmin.canEdit).toBe(true);
    expect(forAdmin.holidays.map((h) => h.date)).toEqual([...forAdmin.holidays.map((h) => h.date)].sort());
    expect((await pm.as.query(api.holidays.list, { year: 2026 })).canEdit).toBe(false);
    await expectCode(finance.as.query(api.holidays.list, { year: 2026 }), 'auth.forbidden');

    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    await expectCode(client.as.query(api.holidays.list, { year: 2026 }), 'auth.forbidden');

    const eid = await holidayNamed(2027, 'Eid al-Fitr');
    await expectCode(
      pm.as.mutation(api.holidays.update, { holidayId: eid.id, date: '2027-03-09', name: eid.name }),
      'auth.forbidden',
    );
    await expectCode(pm.as.mutation(api.holidays.add, { date: '2027-03-11', name: 'Extra' }), 'auth.forbidden');
    await expectCode(pm.as.mutation(api.holidays.remove, { holidayId: eid.id }), 'auth.forbidden');
  });

  it('confirms a movable holiday by saving its declared date, and the seed does not add the estimate back', async () => {
    const eid = await holidayNamed(2027, 'Eid al-Fitr');
    expect(eid).toMatchObject({ date: '2027-03-10', needsConfirmation: true });

    await admin.as.mutation(api.holidays.update, { holidayId: eid.id, date: '2027-03-09', name: eid.name });
    expect(await holidayNamed(2027, 'Eid al-Fitr')).toMatchObject({ date: '2027-03-09', needsConfirmation: false });

    await t.mutation(internal.seed.run, {});
    const { holidays } = await admin.as.query(api.holidays.list, { year: 2027 });
    expect(holidays.filter((h) => h.name === 'Eid al-Fitr')).toHaveLength(1);

    await expectCode(
      admin.as.mutation(api.holidays.update, { holidayId: eid.id, date: '2028-03-09', name: eid.name }),
      'holidays.invalid',
    );
  });

  it('adds declared holidays, refuses duplicate names in a year, and removes only added ones', async () => {
    const id = (await admin.as.mutation(api.holidays.add, {
      date: '2027-03-11',
      name: ' Eid al-Fitr (second day) ',
    })) as Id<'holidays'>;
    expect(await holidayNamed(2027, 'Eid al-Fitr (second day)')).toMatchObject({
      source: 'manual',
      needsConfirmation: false,
    });
    await expectCode(
      admin.as.mutation(api.holidays.add, { date: '2027-03-12', name: 'eid al-fitr' }),
      'holidays.duplicate',
    );

    const christmas = await holidayNamed(2027, 'Christmas Day');
    await expectCode(admin.as.mutation(api.holidays.remove, { holidayId: christmas.id }), 'holidays.seeded');
    await admin.as.mutation(api.holidays.remove, { holidayId: id });
    expect(await holidayNamed(2027, 'Eid al-Fitr (second day)')).toBeUndefined();

    const entries = await t.run((ctx) =>
      ctx.db
        .query('auditLog')
        .collect()
        .then((rows) => rows.filter((row) => row.table === 'holidays' && row.actorId === admin.memberId)),
    );
    expect(entries.map((entry) => entry.action)).toEqual(['insert', 'delete']);
  });

  it('in January adds the next year and asks admins to confirm the movable holidays', async () => {
    vi.setSystemTime(Date.parse('2027-01-02T08:00:00Z'));
    const result = await t.mutation(internal.holidays.januaryReminder, {});
    expect(result.notified).toBe(1);

    const holidays = await t.run((ctx) => ctx.db.query('holidays').collect());
    expect(holidays.some((h) => h.date === '2028-12-25' && h.name === 'Christmas Day')).toBe(true);
    expect(holidays.some((h) => h.date === '2028-02-27' && h.needsConfirmation)).toBe(true);

    const [notification] = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notification).toMatchObject({
      recipientId: admin.memberId,
      event: 'holidays.confirm',
      title: 'Confirm the 2027 public holidays',
      link: '/settings/business-hours',
    });
    expect(notification.body).toContain('Eid al-Fitr, Good Friday, Easter Monday, Eid al-Adha, Mawlid are estimates');

    vi.setSystemTime(Date.parse('2029-01-02T08:00:00Z'));
    await t.mutation(internal.holidays.januaryReminder, {});
    const latest = await t.run((ctx) => ctx.db.query('notifications').order('desc').first());
    expect(latest?.body).toMatch(/There are no estimates for 2029/);
  });
});

describe('business hours', () => {
  const weekdays = [1, 2, 3, 4, 5].map((day) => ({ day, start: '08:30', end: '16:30' }));

  it('shows the hours to settings.manage and sla.manage, and lets settings.manage change them', async () => {
    expect(await pm.as.query(api.businessHours.get, {})).toMatchObject({
      timezone: 'Africa/Lagos',
      canEdit: false,
    });
    await expectCode(finance.as.query(api.businessHours.get, {}), 'auth.forbidden');
    await expectCode(
      pm.as.mutation(api.businessHours.update, { name: 'Studio', timezone: 'Africa/Lagos', weekly: weekdays }),
      'auth.forbidden',
    );

    await admin.as.mutation(api.businessHours.update, {
      name: 'Studio hours',
      timezone: 'Africa/Lagos',
      weekly: [...weekdays].reverse(),
    });
    const hours = await admin.as.query(api.businessHours.get, {});
    expect(hours).toMatchObject({ name: 'Studio hours', canEdit: true });
    expect(hours.weekly).toEqual(weekdays);
  });

  it('refuses unusable hours', async () => {
    const update = (weekly: typeof weekdays, timezone = 'Africa/Lagos') =>
      admin.as.mutation(api.businessHours.update, { name: 'Studio', timezone, weekly });
    await expectCode(update([]), 'businessHours.invalid');
    await expectCode(update([{ day: 1, start: '17:00', end: '09:00' }]), 'businessHours.invalid');
    await expectCode(update([{ day: 7, start: '09:00', end: '17:00' }]), 'businessHours.invalid');
    await expectCode(
      update([
        { day: 1, start: '09:00', end: '13:00' },
        { day: 1, start: '12:00', end: '17:00' },
      ]),
      'businessHours.invalid',
    );
    await expectCode(update(weekdays, 'Mars/Olympus'), 'businessHours.invalid');
  });
});
