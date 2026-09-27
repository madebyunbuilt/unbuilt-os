import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// Uptime monitoring (09-support-and-sla.md). The rule that matters: two failures in a row is an incident, one is a
// blip, and recovery closes what the failure opened. Anything looser wakes people for nothing.

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let clientId: Id<'clients'>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  clientId = (await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' }))
    .clientId;
});

afterEach(() => {
  vi.useRealTimers();
});

const newMonitor = async (overrides: object = {}) => {
  const monitorId = await pm.as.mutation(api.monitors.create, {
    clientId,
    name: 'Glossup checkout',
    url: 'https://glossup.example.com/checkout',
    production: true,
    ...overrides,
  });
  await pm.as.mutation(api.monitors.setPaused, { monitorId, paused: false });
  return monitorId;
};

const fail = async (monitorId: Id<'monitors'>, error = 'timed out') =>
  await t.mutation(internal.monitors.record, { monitorId, ok: false, error });
const pass = async (monitorId: Id<'monitors'>) =>
  await t.mutation(internal.monitors.record, { monitorId, ok: true, statusCode: 200, latencyMs: 120 });

const incidents = async () => await t.run((ctx) => ctx.db.query('incidents').collect());
const tickets = async () => await t.run((ctx) => ctx.db.query('tickets').collect());

describe('what a monitor may point at', () => {
  it('refuses somewhere inside a private network', async () => {
    for (const url of [
      'http://localhost:3000/health',
      'http://127.0.0.1/health',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      await expectCode(
        pm.as.mutation(api.monitors.create, { clientId, name: 'Inside', url, production: false }),
        'monitors.invalid',
      );
    }
  });

  it('assumes https when somebody types a bare domain', async () => {
    const monitorId = await pm.as.mutation(api.monitors.create, {
      clientId,
      name: 'Glossup',
      url: 'glossup.example.com/health',
      production: true,
    });
    expect((await pm.as.query(api.monitors.get, { monitorId }))!.url).toBe('https://glossup.example.com/health');
  });

  it('leaves an explicit http alone, because that is a real choice', async () => {
    const monitorId = await pm.as.mutation(api.monitors.create, {
      clientId,
      name: 'Old box',
      url: 'http://glossup.example.com/health',
      production: false,
    });
    expect((await pm.as.query(api.monitors.get, { monitorId }))!.url).toBe('http://glossup.example.com/health');
  });

  it('still refuses a private address typed without a scheme', async () => {
    await expectCode(
      pm.as.mutation(api.monitors.create, { clientId, name: 'Inside', url: 'localhost:3000', production: false }),
      'monitors.invalid',
    );
  });

  it('refuses something that is not a web address at all', async () => {
    await expectCode(
      pm.as.mutation(api.monitors.create, { clientId, name: 'Nope', url: 'file:///etc/passwd', production: false }),
      'monitors.invalid',
    );
  });

  it('starts paused, because nothing is known until it has been checked', async () => {
    const monitorId = await pm.as.mutation(api.monitors.create, {
      clientId,
      name: 'Glossup',
      url: 'https://glossup.example.com',
      production: true,
    });
    expect((await pm.as.query(api.monitors.get, { monitorId }))!.status).toBe('paused');
  });
});

describe('when a site goes down', () => {
  it('treats one failure as a blip', async () => {
    const monitorId = await newMonitor();
    await fail(monitorId);
    expect(await incidents()).toHaveLength(0);
    expect(await tickets()).toHaveLength(0);
    expect((await pm.as.query(api.monitors.get, { monitorId }))!.status).not.toBe('down');
  });

  it('opens exactly one incident and one ticket on the second', async () => {
    const monitorId = await newMonitor();
    await fail(monitorId);
    await fail(monitorId);

    expect(await incidents()).toHaveLength(1);
    const raised = await tickets();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ channel: 'monitor', priority: 'p1', subject: 'Glossup checkout is down' });
    expect((await pm.as.query(api.monitors.get, { monitorId }))!.status).toBe('down');

    // Still failing an hour later is the same incident, not a new one every five minutes.
    await fail(monitorId);
    await fail(monitorId);
    expect(await incidents()).toHaveLength(1);
    expect(await tickets()).toHaveLength(1);
  });

  it('raises a P2 for something that is not the live site', async () => {
    const monitorId = await newMonitor({ name: 'Staging', production: false });
    await fail(monitorId);
    await fail(monitorId);
    expect((await tickets())[0].priority).toBe('p2');
  });

  it('tells the team, and only shouts about production', async () => {
    const monitorId = await newMonitor();
    await fail(monitorId);
    await fail(monitorId);
    const told = (await t.run((ctx) => ctx.db.query('notifications').collect())).filter(
      (n) => n.event === 'monitor.down',
    );
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((n) => n.channels.whatsapp)).toBe(true);

    const staging = await newMonitor({ name: 'Staging', production: false });
    await fail(staging);
    await fail(staging);
    const quiet = (await t.run((ctx) => ctx.db.query('notifications').collect())).filter(
      (n) => n.event === 'monitor.down' && n.body.includes('Staging'),
    );
    expect(quiet.some((n) => n.channels.whatsapp)).toBe(false);
  });
});

describe('when it comes back', () => {
  it('closes the incident and says so on the ticket', async () => {
    const monitorId = await newMonitor();
    await fail(monitorId);
    await fail(monitorId);
    vi.setSystemTime(Date.parse('2026-10-12T09:25:00Z'));
    await pass(monitorId);

    const [incident] = await incidents();
    expect(incident.resolvedAt).toBeDefined();
    expect((await pm.as.query(api.monitors.get, { monitorId }))!.status).toBe('up');

    const messages = await t.run((ctx) => ctx.db.query('ticketMessages').collect());
    const recovery = messages.find((message) => message.body.includes('answering again'));
    expect(recovery).toBeDefined();
    expect(recovery!.body).toContain('25 minutes');
    // Said by the system, and the client can see it: it is their site that was down.
    expect(recovery).toMatchObject({ authorKind: 'system', visibility: 'public' });
  });

  it('opens a fresh incident if it goes down again afterwards', async () => {
    const monitorId = await newMonitor();
    await fail(monitorId);
    await fail(monitorId);
    await pass(monitorId);
    await fail(monitorId);
    await fail(monitorId);
    expect(await incidents()).toHaveLength(2);
    expect(await tickets()).toHaveLength(2);
  });
});

describe('pausing and removing', () => {
  it('records nothing while paused', async () => {
    const monitorId = await newMonitor();
    await pm.as.mutation(api.monitors.setPaused, { monitorId, paused: true });
    await fail(monitorId);
    await fail(monitorId);
    expect(await incidents()).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query('monitorChecks').collect())).toHaveLength(0);
  });

  it('is not offered to the cron while paused', async () => {
    const monitorId = await newMonitor();
    expect(await t.mutation(internal.monitors.due, {})).toHaveLength(1);
    await pm.as.mutation(api.monitors.setPaused, { monitorId, paused: true });
    expect(await t.mutation(internal.monitors.due, {})).toHaveLength(0);
  });

  it('waits for its interval before asking again', async () => {
    const monitorId = await newMonitor();
    await pass(monitorId);
    expect(await t.mutation(internal.monitors.due, {})).toHaveLength(0);
    // Five minutes later, by default.
    vi.setSystemTime(Date.parse('2026-10-12T09:06:00Z'));
    expect(await t.mutation(internal.monitors.due, {})).toHaveLength(1);
  });

  it('will not be removed in the middle of an incident', async () => {
    const monitorId = await newMonitor();
    await fail(monitorId);
    await fail(monitorId);
    await expectCode(pm.as.mutation(api.monitors.remove, { monitorId }), 'monitors.openIncident');

    await pass(monitorId);
    await pm.as.mutation(api.monitors.remove, { monitorId });
    expect(await t.run((ctx) => ctx.db.query('monitors').collect())).toHaveLength(0);
    // Its check history goes with it.
    expect(await t.run((ctx) => ctx.db.query('monitorChecks').collect())).toHaveLength(0);
  });

  it('forgets checks older than ninety days, and keeps the rest', async () => {
    const monitorId = await newMonitor();
    await pass(monitorId);
    vi.setSystemTime(Date.parse('2027-02-01T09:00:00Z'));
    await pass(monitorId);
    expect(await t.mutation(internal.monitors.forgetOldChecks, {})).toEqual({ removed: 1 });
    expect(await t.run((ctx) => ctx.db.query('monitorChecks').collect())).toHaveLength(1);
  });
});

describe('who may keep monitors', () => {
  it('is closed to a role without monitors.manage', async () => {
    const monitorId = await newMonitor();
    const finance = await createTeamMember(t, roles.finance, { email: 'zainab@unbuilt.studio', name: 'Zainab B' });
    await expectCode(finance.as.query(api.monitors.list, {}), 'auth.forbidden');
    await expectCode(finance.as.query(api.monitors.get, { monitorId }), 'auth.forbidden');
    await expectCode(
      finance.as.mutation(api.monitors.create, {
        clientId,
        name: 'x',
        url: 'https://example.com',
        production: false,
      }),
      'auth.forbidden',
    );
    await expectCode(finance.as.mutation(api.monitors.setPaused, { monitorId, paused: true }), 'auth.forbidden');
    await expectCode(finance.as.mutation(api.monitors.remove, { monitorId }), 'auth.forbidden');
  });
});
