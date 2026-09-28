import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import { addBusinessMinutes } from './lib/businessTime';
import { DEFAULT_CLAUSES, DEFAULT_DOCUMENT_TEMPLATES } from './lib/documentTemplateSeeds';
import { DEFAULT_ROLES } from './lib/permissions';
import { lagosYear } from './seed';
import { newTest, type TestConvex } from './test.auth';

let t: TestConvex;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T09:00:00+01:00'));
  t = newTest();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const owner = { ownerEmail: ' Owner@Unbuilt.Studio ', ownerName: 'Studio Owner' };

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

describe('seed', () => {
  it('creates the defaults once and changes nothing on a second run', async () => {
    const first = await t.mutation(internal.seed.run, owner);
    expect(first.created).toEqual({
      roles: DEFAULT_ROLES.length,
      orgSettings: 1,
      businessHours: 1,
      siteSettings: 1,
      holidays: 2 * (6 + 5),
      slaPolicies: 3,
      pipeline: 6 + 7,
      projectTemplates: 6,
      documentTemplates: DEFAULT_CLAUSES.length + DEFAULT_DOCUMENT_TEMPLATES.length,
      ownerInvite: 1,
      sampleRecords: 0,
    });
    const auditAfterFirst = await t.run((ctx) => ctx.db.query('auditLog').collect());

    const second = await t.mutation(internal.seed.run, owner);
    expect(second.created).toEqual({
      roles: 0,
      orgSettings: 0,
      businessHours: 0,
      siteSettings: 0,
      holidays: 0,
      slaPolicies: 0,
      pipeline: 0,
      projectTemplates: 0,
      documentTemplates: 0,
      ownerInvite: 0,
      sampleRecords: 0,
    });
    expect(await t.run((ctx) => ctx.db.query('auditLog').collect())).toHaveLength(auditAfterFirst.length);
  });

  it('seeds every default role as a system role with its exact permissions', async () => {
    await t.mutation(internal.seed.run, {});
    const roles = await t.run((ctx) => ctx.db.query('roles').collect());
    expect(roles.map((role) => [role.key, role.isSystem, role.permissions])).toEqual(
      DEFAULT_ROLES.map((role) => [role.key, true, [...role.permissions]]),
    );
  });

  it('never overwrites a role the Owner has edited', async () => {
    await t.mutation(internal.seed.run, {});
    await t.run(async (ctx) => {
      const member = await ctx.db
        .query('roles')
        .withIndex('by_key', (q) => q.eq('key', 'member'))
        .unique();
      await ctx.db.patch('roles', member!._id, { permissions: ['time.log.own'] });
    });
    await t.mutation(internal.seed.run, {});
    const member = await t.run((ctx) =>
      ctx.db
        .query('roles')
        .withIndex('by_key', (q) => q.eq('key', 'member'))
        .unique(),
    );
    expect(member?.permissions).toEqual(['time.log.own']);
  });

  it('invites one Owner, with a normalised email, and keeps the first one on later runs', async () => {
    const first = await t.mutation(internal.seed.run, owner);
    expect(first.ownerEmail).toBe('owner@unbuilt.studio');
    const second = await t.mutation(internal.seed.run, { ownerEmail: 'someone-else@unbuilt.studio' });
    expect(second.ownerEmail).toBe('owner@unbuilt.studio');

    const members = await t.run((ctx) => ctx.db.query('teamMembers').collect());
    expect(members).toEqual([
      expect.objectContaining({ email: 'owner@unbuilt.studio', name: 'Studio Owner', status: 'invited' }),
    ]);
    const auditForInvite = await t.run((ctx) =>
      ctx.db
        .query('auditLog')
        .withIndex('by_target', (q) => q.eq('table', 'teamMembers'))
        .collect(),
    );
    expect(auditForInvite).toEqual([
      expect.objectContaining({ actorKind: 'system', permission: 'seed', action: 'insert' }),
    ]);
  });

  it('warns when there is no Owner yet and rejects a malformed owner email', async () => {
    const result = await t.mutation(internal.seed.run, {});
    expect(result.warnings).toContain('No Owner exists yet. Run again with ownerEmail to invite one.');
    await expectCode(t.mutation(internal.seed.run, { ownerEmail: 'not-an-email' }), 'seed.invalidEmail');
  });

  it('refuses to make an existing non-owner team member the Owner', async () => {
    await t.mutation(internal.seed.run, {});
    await t.run(async (ctx) => {
      const member = await ctx.db
        .query('roles')
        .withIndex('by_key', (q) => q.eq('key', 'member'))
        .unique();
      await ctx.db.insert('teamMembers', {
        name: 'Existing',
        email: 'owner@unbuilt.studio',
        employmentType: 'employee',
        roleId: member!._id,
        status: 'active',
        timezone: 'Africa/Lagos',
        skills: [],
      });
    });
    await expectCode(t.mutation(internal.seed.run, owner), 'seed.ownerConflict');
  });

  it('seeds fixed holidays for this year and next, and movable ones flagged for confirmation', async () => {
    await t.mutation(internal.seed.run, {});
    const holidays = await t.run((ctx) => ctx.db.query('holidays').collect());
    const byKey = new Map(holidays.map((h) => [`${h.date} ${h.name}`, h]));

    for (const year of [2026, 2027]) {
      expect(byKey.get(`${year}-10-01 Independence Day`)).toMatchObject({ needsConfirmation: false, country: 'NG' });
      expect(byKey.get(`${year}-06-12 Democracy Day`)?.needsConfirmation).toBe(false);
    }
    expect(byKey.get('2026-04-03 Good Friday')?.needsConfirmation).toBe(true);
    expect(byKey.get('2027-05-17 Eid al-Adha')?.needsConfirmation).toBe(true);
    expect(holidays.every((h) => h.source === 'seed' && !h.recurring)).toBe(true);
    expect(holidays.some((h) => h.date.startsWith('2028'))).toBe(false);
  });

  it('seeds the default calendar and three SLA policies measured in business time', async () => {
    await t.mutation(internal.seed.run, {});
    const [hours] = await t.run((ctx) => ctx.db.query('businessHours').collect());
    expect(hours).toMatchObject({ timezone: 'Africa/Lagos', isDefault: true });
    expect(hours.weekly.map((w) => w.day)).toEqual([1, 2, 3, 4, 5]);

    const policies = await t.run((ctx) => ctx.db.query('slaPolicies').collect());
    expect(policies.map((p) => p.name)).toEqual(['Standard', 'Priority', 'Retainer']);
    const p2 = policies[0].targets.find((target) => target.priority === 'p2')!;
    expect(p2).toEqual({ priority: 'p2', firstResponseMinutes: 240, resolutionMinutes: 1440 });
    expect(policies[0].targets.find((target) => target.priority === 'p4')?.resolutionMinutes).toBeUndefined();

    // 3 business days from 16:30 on a Friday lands at 16:30 on the following Wednesday.
    const due = addBusinessMinutes(Date.parse('2026-09-11T16:30:00+01:00'), p2.resolutionMinutes!, hours, []);
    expect(due).toBe(Date.parse('2026-09-16T16:30:00+01:00'));
  });

  it('adds sample data only where ALLOW_SAMPLE_DATA is on, with example.com addresses only', async () => {
    await expectCode(t.mutation(internal.seed.run, { includeSampleData: true }), 'seed.sampleDataNotAllowed');

    vi.stubEnv('ALLOW_SAMPLE_DATA', 'true');
    const first = await t.mutation(internal.seed.run, { includeSampleData: true });
    expect(first.created.sampleRecords).toBe(3 + 2 + 3);
    const second = await t.mutation(internal.seed.run, { includeSampleData: true });
    expect(second.created.sampleRecords).toBe(0);

    const emails = await t.run(async (ctx) => [
      ...(await ctx.db.query('teamMembers').collect()).map((m) => m.email),
      ...(await ctx.db.query('contacts').collect()).map((c) => c.email),
    ]);
    expect(emails.every((email) => email.endsWith('@example.com'))).toBe(true);
  });

  it('uses the Lagos calendar year', () => {
    expect(lagosYear(Date.parse('2026-12-31T23:30:00Z'))).toBe(2027);
    expect(lagosYear(Date.parse('2026-12-31T22:30:00Z'))).toBe(2026);
  });
});
