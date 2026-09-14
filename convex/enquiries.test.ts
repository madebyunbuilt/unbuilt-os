import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

const ORIGIN = 'https://unbuilt.studio';
const turnstile = vi.fn();

let t: TestConvex;
let roles: Record<string, Id<'roles'>>;
let admin: Awaited<ReturnType<typeof createTeamMember>>;
let pm: Awaited<ReturnType<typeof createTeamMember>>;
let finance: Awaited<ReturnType<typeof createTeamMember>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-14T09:00:00Z'));
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret');
  vi.stubEnv('ENQUIRY_ALLOWED_ORIGINS', `${ORIGIN},https://unbuilt-studio-web-*.vercel.app`);
  turnstile.mockReset().mockResolvedValue({ success: true });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const form = new URLSearchParams(init.body as string);
    return new Response(JSON.stringify(await turnstile(Object.fromEntries(form))));
  });

  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  admin = await createTeamMember(t, roles.admin, { email: 'kemi@unbuilt.studio', name: 'Kemi Bello' });
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio', name: 'Funmi' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const form = (overrides: object = {}) => ({
  services: ['web', 'design'],
  stage: 'design',
  budget: 'mid',
  timeline: '1-3',
  about: 'A booking platform for salons.',
  name: 'Tolu Adeyemi',
  email: 'Tolu@Glowhaus.co',
  company: 'Glowhaus',
  turnstileToken: 'token-ok',
  ...overrides,
});

const post = (body: unknown, { origin = ORIGIN, ip = '203.0.113.7' }: { origin?: string | null; ip?: string } = {}) =>
  t.fetch('/public/enquiries', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'user-agent': 'Mozilla/5.0 test',
      ...(origin ? { origin } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const enquiries = () => t.run((ctx) => ctx.db.query('enquiries').collect());

describe('POST /public/enquiries', () => {
  it('stores a valid enquiry, notifies enquiries.manage holders and returns no ids', async () => {
    const response = await post(form());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(turnstile).toHaveBeenCalledWith({ secret: 'test-secret', response: 'token-ok', remoteip: '203.0.113.7' });

    const [enquiry] = await enquiries();
    expect(enquiry).toMatchObject({
      source: 'website',
      email: 'tolu@glowhaus.co',
      services: ['web', 'design'],
      budget: 'mid',
      status: 'new',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 test',
      turnstilePassed: true,
    });

    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notifications.map((n) => n.recipientId).sort()).toEqual([admin.memberId, pm.memberId].sort());
    expect(notifications[0]).toMatchObject({
      title: 'New enquiry from Tolu Adeyemi at Glowhaus',
      body: 'Web platforms, Product design',
      link: `/crm/enquiries/${enquiry._id}`,
    });
  });

  it('rejects invalid Turnstile tokens, disallowed origins and bad bodies without creating a row', async () => {
    turnstile.mockResolvedValueOnce({ success: false });
    expect((await post(form())).status).toBe(403);
    expect((await post(form(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(form(), { origin: null })).status).toBe(403);
    expect((await post(form({ email: 'not-an-email' }))).status).toBe(400);
    expect((await post(form({ services: [] }))).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
    expect((await post(form({ about: 'x'.repeat(30_000) }))).status).toBe(413);
    expect(await enquiries()).toEqual([]);

    // Website preview deployments match the wildcard.
    expect((await post(form(), { origin: 'https://unbuilt-studio-web-abc123.vercel.app' })).status).toBe(200);
  });

  it('refuses every enquiry when Turnstile is not configured', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect((await post(form())).status).toBe(503);
    expect(await enquiries()).toEqual([]);
  });

  it('allows 5 an hour per IP and 3 a day per email', async () => {
    for (let i = 0; i < 3; i++) expect((await post(form(), { ip: `198.51.100.${i}` })).status).toBe(200);
    const limited = await post(form(), { ip: '198.51.100.9' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, error: 'rate_limited' });

    // Five different addresses from one IP are allowed; the sixth is not.
    for (let i = 0; i < 5; i++) {
      expect((await post(form({ email: `p${i}@x.co` }), { ip: '192.0.2.1' })).status).toBe(200);
    }
    expect((await post(form({ email: 'p9@x.co' }), { ip: '192.0.2.1' })).status).toBe(429);
    expect(await enquiries()).toHaveLength(3 + 5);

    // A new window opens after an hour for the IP and a day for the email.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect((await post(form({ email: 'p10@x.co' }), { ip: '192.0.2.1' })).status).toBe(200);
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    expect((await post(form(), { ip: '198.51.100.20' })).status).toBe(200);

    vi.setSystemTime(Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect((await t.mutation(internal.enquiries.cleanupRateLimits, {})).deleted).toBeGreaterThan(0);
  });

  it('answers the CORS preflight only for allowed origins', async () => {
    const allowed = await t.fetch('/public/enquiries', { method: 'OPTIONS', headers: { origin: ORIGIN } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    const refused = await t.fetch('/public/enquiries', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(refused.status).toBe(403);
  });
});

async function receiveEnquiry(overrides: object = {}) {
  await post(form(overrides));
  const all = await enquiries();
  return all[all.length - 1]._id;
}

describe('enquiry inbox', () => {
  it('shows the sender’s IP and browser only to audit.view holders', async () => {
    const enquiryId = await receiveEnquiry();
    const forAdmin = await admin.as.query(api.enquiries.get, { enquiryId });
    expect(forAdmin).toMatchObject({ ip: '203.0.113.7', stage: 'Designs, no code', budget: '₦4m to ₦12m' });
    const forPm = await pm.as.query(api.enquiries.get, { enquiryId });
    expect(forPm).not.toHaveProperty('ip');
    expect(forPm).not.toHaveProperty('userAgent');
    expect((await finance.as.query(api.enquiries.list, {})).map((e) => e.id)).toEqual([enquiryId]);

    await expectCode(finance.as.mutation(api.enquiries.markSpam, { enquiryId }), 'auth.forbidden');
    const member = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio' });
    await expectCode(member.as.query(api.enquiries.list, {}), 'auth.forbidden');
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@portal.co' });
    await expectCode(client.as.query(api.enquiries.get, { enquiryId }), 'auth.forbidden');
  });

  it('moves enquiries between new, reviewed, spam and closed', async () => {
    const enquiryId = await receiveEnquiry();
    await pm.as.mutation(api.enquiries.markReviewed, { enquiryId });
    await pm.as.mutation(api.enquiries.markSpam, { enquiryId });
    expect(await pm.as.query(api.enquiries.list, {})).toEqual([]);
    expect(await pm.as.query(api.enquiries.list, { view: 'spam' })).toMatchObject([{ id: enquiryId, status: 'spam' }]);
    await pm.as.mutation(api.enquiries.reopen, { enquiryId });
    await pm.as.mutation(api.enquiries.close, { enquiryId });
    await expectCode(pm.as.mutation(api.enquiries.close, { enquiryId }), 'crm.invalid');
  });

  it('links an enquiry from an existing contact’s email to that client, with its open deals', async () => {
    const clientId = await pm.as.mutation(api.clients.create, { displayName: 'Glowhaus', kind: 'company', tags: [] });
    await pm.as.mutation(api.contacts.create, { clientId, name: 'Tolu', email: 'tolu@glowhaus.co', isBilling: true });
    await pm.as.mutation(api.deals.create, {
      clientId,
      title: 'Salon app phase 1',
      valueMinor: 500_000_000,
      currency: 'NGN',
      services: [],
    });
    const enquiryId = await receiveEnquiry();

    const detail = await pm.as.query(api.enquiries.get, { enquiryId });
    expect(detail.suggestedClient).toEqual({ clientId, clientName: 'Glowhaus', reason: 'email' });
    expect(detail.existing).toMatchObject([{ clientId, openDeals: [{ title: 'Salon app phase 1' }] }]);
    expect((await pm.as.query(api.enquiries.list, {}))[0].existingClient).toEqual({ id: clientId, name: 'Glowhaus' });

    const result = await pm.as.mutation(api.enquiries.convert, {
      enquiryId,
      client: { kind: 'existing', clientId },
      deal: { title: 'Salon app phase 2', valueMinor: 800_000_000, currency: 'NGN' },
    });
    expect(result.clientId).toBe(clientId);
    const clients = await t.run((ctx) => ctx.db.query('clients').collect());
    const contacts = await t.run((ctx) => ctx.db.query('contacts').collect());
    expect(clients).toHaveLength(1);
    expect(contacts).toHaveLength(1);

    const deal = await pm.as.query(api.deals.get, { dealId: result.dealId });
    expect(deal).toMatchObject({
      stage: { name: 'New' },
      probabilityBps: 1000,
      services: ['web', 'design'],
      source: 'website',
      enquiryId,
      primaryContact: { email: 'tolu@glowhaus.co' },
    });
    expect(await t.run((ctx) => ctx.db.get('enquiries', enquiryId))).toMatchObject({
      status: 'converted',
      clientId,
      dealId: result.dealId,
    });
    await expectCode(
      pm.as.mutation(api.enquiries.convert, {
        enquiryId,
        client: { kind: 'existing', clientId },
        deal: { title: 'Again', valueMinor: 1, currency: 'NGN' },
      }),
      'crm.alreadyConverted',
    );
  });

  it('suggests a client by company domain or name, never by a free email provider', async () => {
    const acme = await pm.as.mutation(api.clients.create, {
      displayName: 'Acme',
      kind: 'company',
      website: 'https://www.acme.ng',
      tags: [],
    });
    const byDomain = await receiveEnquiry({ email: 'new.person@acme.ng', company: undefined });
    expect((await pm.as.query(api.enquiries.get, { enquiryId: byDomain })).suggestedClient).toMatchObject({
      clientId: acme,
      reason: 'domain',
    });
    const byName = await receiveEnquiry({ email: 'founder@gmail.com', company: 'ACME' });
    expect((await pm.as.query(api.enquiries.get, { enquiryId: byName })).suggestedClient).toMatchObject({
      reason: 'company',
    });
    const none = await receiveEnquiry({ email: 'someone@gmail.com', company: 'Other' });
    expect((await pm.as.query(api.enquiries.get, { enquiryId: none })).suggestedClient).toBeNull();
  });

  it('converts into a new client and contact, needing the permissions for each record', async () => {
    const enquiryId = await receiveEnquiry();
    const convert = {
      enquiryId,
      client: { kind: 'new' as const, displayName: 'Glowhaus', clientKind: 'company' as const },
      deal: { title: 'Salon booking platform', valueMinor: 900_000_000, currency: 'NGN' as const },
    };
    await expectCode(finance.as.mutation(api.enquiries.convert, convert), 'auth.forbidden');
    const { clientId, contactId } = await pm.as.mutation(api.enquiries.convert, convert);
    expect(await pm.as.query(api.clients.get, { clientId })).toMatchObject({
      status: 'lead',
      ownerMemberId: pm.memberId,
    });
    expect(await pm.as.query(api.contacts.listForClient, { clientId })).toMatchObject([
      { id: contactId, name: 'Tolu Adeyemi', isPrimary: true },
    ]);
  });

  it('records enquiries that arrived another way', async () => {
    const enquiryId = await pm.as.mutation(api.enquiries.createManual, {
      source: 'referral',
      name: 'Bisi',
      email: 'bisi@example.com',
      services: ['mobile'],
    });
    expect(await pm.as.query(api.enquiries.get, { enquiryId })).toMatchObject({
      source: 'referral',
      status: 'reviewed',
    });
    const notified = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notified.map((n) => n.recipientId)).toEqual([admin.memberId]);
  });
});
