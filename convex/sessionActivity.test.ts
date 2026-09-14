import { type ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { createClientUser, createTeamMember, newTest, seedRoles, type TestConvex } from './test.auth';
import { ACTIVITY_RETENTION_MS, RECORD_INTERVAL_MS } from './sessionActivity';

let t: TestConvex;
let roles: Awaited<ReturnType<typeof seedRoles>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-14T09:00:00Z'));
  t = newTest();
  roles = await seedRoles(t);
});

afterEach(() => {
  vi.useRealTimers();
});

const rows = () => t.run((ctx) => ctx.db.query('sessionActivity').collect());

describe('session activity', () => {
  it('records real use per session without auditing it, writing at most once a minute', async () => {
    const member = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    await member.as.mutation(api.sessionActivity.record, {});
    expect(await rows()).toMatchObject([{ sessionId: member.sessionId, lastActiveAt: Date.now() }]);

    const first = Date.now();
    vi.setSystemTime(first + RECORD_INTERVAL_MS - 1);
    await member.as.mutation(api.sessionActivity.record, {});
    expect((await rows())[0].lastActiveAt).toBe(first);
    vi.setSystemTime(first + RECORD_INTERVAL_MS);
    await member.as.mutation(api.sessionActivity.record, {});
    expect((await rows())[0].lastActiveAt).toBe(first + RECORD_INTERVAL_MS);

    const audited = await t.run((ctx) => ctx.db.query('auditLog').collect());
    expect(audited.filter((entry) => entry.table === 'sessionActivity')).toEqual([]);
  });

  it('is only for team sessions', async () => {
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
    const error = await client.as.mutation(api.sessionActivity.record, {}).catch((e: unknown) => e);
    expect((error as ConvexError<{ code: string }>).data.code).toBe('auth.forbidden');
    await expect(t.mutation(api.sessionActivity.record, {})).rejects.toThrow(/Sign in/);
  });

  it('clears activity older than a day each night', async () => {
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('sessionActivity', {
        sessionId: 'old',
        authUserId: 'u1',
        lastActiveAt: now - ACTIVITY_RETENTION_MS - 1,
      });
      await ctx.db.insert('sessionActivity', { sessionId: 'recent', authUserId: 'u2', lastActiveAt: now - 60_000 });
    });
    expect(await t.mutation(internal.sessionActivity.cleanup, {})).toEqual({ deleted: 1 });
    expect((await rows()).map((row) => row.sessionId)).toEqual(['recent']);
  });
});
