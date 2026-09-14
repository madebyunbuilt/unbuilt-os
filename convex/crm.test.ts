import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { sendAuthEmail } from './lib/authEmails';
import {
  createAuthSession,
  createClientUser,
  createTeamMember,
  newTest,
  seedRoles,
  type TestConvex,
} from './test.auth';

vi.mock('./lib/authEmails', () => ({ sendAuthEmail: vi.fn() }));

const portalOwnClient = makeFunctionReference<'query'>('lib/functions.fixtures:portalOwnClient');

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
let member: Awaited<ReturnType<typeof createTeamMember>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(Date.parse('2026-09-14T09:00:00Z'));
  vi.stubEnv('AUTH_ALLOWED_HOSTS', 'os.unbuilt.studio,portal.unbuilt.studio');
  vi.mocked(sendAuthEmail).mockClear();
  t = newTest();
  roles = await seedRoles(t);
  admin = await createTeamMember(t, roles.admin, { email: 'kemi@unbuilt.studio', name: 'Kemi Bello' });
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  finance = await createTeamMember(t, roles.finance, { email: 'finance@unbuilt.studio', name: 'Funmi Finance' });
  member = await createTeamMember(t, roles.member, { email: 'dayo@unbuilt.studio', name: 'Dayo Ade' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

const newClient = (overrides: object = {}) => ({
  displayName: 'Glossup',
  kind: 'company' as const,
  industry: 'Beauty',
  website: 'glossup.com',
  tags: ['Retainer', ' retainer', 'ecommerce'],
  ...overrides,
});

const contactDetails = (overrides: object = {}) => ({
  name: 'Ada Obi',
  email: ' Ada@Glossup.com ',
  isBilling: true,
  ...overrides,
});

const newContact = (clientId: Id<'clients'>, overrides: object = {}) => ({ clientId, ...contactDetails(overrides) });

const timelineOf = async (clientId: Id<'clients'>) =>
  (
    await admin.as.query(api.activities.list, {
      subject: { table: 'clients', id: clientId },
      paginationOpts: { cursor: null, numItems: 50 },
    })
  ).page;

describe('clients', () => {
  it('creates a lead owned by the creator, with studio defaults and a timeline entry', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    const client = await pm.as.query(api.clients.get, { clientId });
    expect(client).toMatchObject({
      displayName: 'Glossup',
      status: 'lead',
      ownerMemberId: pm.memberId,
      ownerName: 'Tobi Ade',
      website: 'https://glossup.com',
      tags: ['retainer', 'ecommerce'],
      defaultCurrency: 'NGN',
      timezone: 'Africa/Lagos',
      vatTreatment: 'standard',
      whtApplies: false,
      portalEnabled: false,
    });
    expect((await timelineOf(clientId)).map((entry) => entry.title)).toEqual(['Client created']);

    await expectCode(pm.as.mutation(api.clients.create, newClient({ displayName: 'glossup' })), 'crm.duplicate');
    await expectCode(finance.as.mutation(api.clients.create, newClient({ displayName: 'Other' })), 'auth.forbidden');
  });

  it('lists and filters clients for clients.view only, hiding archived ones unless asked', async () => {
    const glossup = await pm.as.mutation(api.clients.create, newClient());
    const qravit = await pm.as.mutation(api.clients.create, newClient({ displayName: 'Qravit', tags: ['saas'] }));
    await admin.as.mutation(api.clients.setStatus, { clientId: qravit, status: 'archived' });

    expect((await finance.as.query(api.clients.list, {})).map((c) => c.id)).toEqual([glossup]);
    expect((await finance.as.query(api.clients.list, { status: 'archived' })).map((c) => c.id)).toEqual([qravit]);
    expect(await finance.as.query(api.clients.list, { tag: 'saas' })).toEqual([]);
    expect((await finance.as.query(api.clients.list, { search: 'gloss' })).map((c) => c.id)).toEqual([glossup]);
    expect(await finance.as.query(api.clients.facets, {})).toEqual({
      tags: ['ecommerce', 'retainer', 'saas'],
      industries: ['Beauty'],
    });

    await expectCode(member.as.query(api.clients.list, {}), 'auth.forbidden');
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@portal.co' });
    await expectCode(client.as.query(api.clients.list, {}), 'auth.forbidden');
    await expectCode(client.as.query(api.clients.get, { clientId: glossup }), 'auth.forbidden');
  });

  it('lets project managers edit the client but only Owner, Admins and Finance edit billing details', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    await pm.as.mutation(api.clients.update, {
      clientId,
      ...newClient({ displayName: 'Glossup Ltd', ownerMemberId: admin.memberId }),
    });
    expect((await pm.as.query(api.clients.get, { clientId })).ownerName).toBe('Kemi Bello');

    const billing = {
      clientId,
      legalName: 'Glossup Limited',
      addressLines: ['12 Admiralty Way', ' ', 'Lekki'],
      tin: '12345678-0001',
      vatTreatment: 'zero_rated' as const,
      whtApplies: true,
      whtBps: 500,
      defaultCurrency: 'USD',
      paymentTermsDays: 14,
    };
    await expectCode(pm.as.mutation(api.clients.updateBilling, billing), 'auth.forbidden');
    await finance.as.mutation(api.clients.updateBilling, billing);
    expect(await finance.as.query(api.clients.get, { clientId })).toMatchObject({
      legalName: 'Glossup Limited',
      addressLines: ['12 Admiralty Way', 'Lekki'],
      vatTreatment: 'zero_rated',
      whtBps: 500,
      defaultCurrency: 'USD',
    });
    await expectCode(finance.as.mutation(api.clients.updateBilling, { ...billing, whtBps: undefined }), 'crm.invalid');
    await expectCode(
      finance.as.mutation(api.clients.updateBilling, { ...billing, defaultCurrency: 'GBP' }),
      'crm.invalid',
    );
    await expectCode(finance.as.mutation(api.clients.update, { clientId, ...newClient() }), 'auth.forbidden');
  });

  it('records manual status changes with the reason', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    await pm.as.mutation(api.clients.setStatus, { clientId, status: 'active', reason: 'Signed retainer by email' });
    const [latest] = await timelineOf(clientId);
    expect(latest).toMatchObject({
      type: 'status_change',
      title: 'Status changed from Lead to Active',
      body: 'Signed retainer by email',
      actorName: 'Tobi Ade',
      canEdit: false,
      canDelete: false,
    });
  });

  it('deletes a client created by mistake, but only archives one whose contact used the portal', async () => {
    const mistake = await pm.as.mutation(api.clients.create, newClient());
    await pm.as.mutation(api.contacts.create, newContact(mistake));
    await expectCode(pm.as.mutation(api.clients.remove, { clientId: mistake }), 'auth.forbidden');
    await admin.as.mutation(api.clients.remove, { clientId: mistake });
    expect(await t.run((ctx) => ctx.db.query('contacts').collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('activities').collect())).toEqual([]);

    const used = await createClientUser(t, roles.client_admin, { clientName: 'Used', email: 'ada@used.co' });
    await expectCode(admin.as.mutation(api.clients.remove, { clientId: used.clientId }), 'crm.hasHistory');
  });

  it('turning the portal off signs every contact out at once', async () => {
    const portal = await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@portal.co' });
    await portal.as.query(portalOwnClient, {});
    await expectCode(
      finance.as.mutation(api.clients.setPortalEnabled, { clientId: portal.clientId, enabled: false }),
      'auth.forbidden',
    );
    await pm.as.mutation(api.clients.setPortalEnabled, { clientId: portal.clientId, enabled: false });
    await expectCode(portal.as.query(portalOwnClient, {}), 'auth.unauthenticated');
  });
});

describe('contacts', () => {
  it('adds contacts with the first as primary, and refuses duplicates on the same client', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    const ada = await pm.as.mutation(api.contacts.create, newContact(clientId, { whatsapp: '+234 801 234 5678' }));
    const bayo = await pm.as.mutation(
      api.contacts.create,
      newContact(clientId, { name: 'Bayo', email: 'bayo@glossup.com', isBilling: false }),
    );
    const contacts = await finance.as.query(api.contacts.listForClient, { clientId });
    expect(contacts.map((c) => [c.name, c.email, c.isPrimary])).toEqual([
      ['Ada Obi', 'ada@glossup.com', true],
      ['Bayo', 'bayo@glossup.com', false],
    ]);
    expect(contacts[0].whatsapp).toBe('+2348012345678');
    await expectCode(pm.as.mutation(api.contacts.create, newContact(clientId)), 'crm.duplicate');

    await pm.as.mutation(api.contacts.setPrimary, { contactId: bayo });
    expect((await pm.as.query(api.contacts.listForClient, { clientId }))[0].id).toBe(bayo);
    expect((await pm.as.query(api.contacts.search, { query: 'ada' })).map((c) => [c.id, c.clientName])).toEqual([
      [ada, 'Glossup'],
    ]);

    await expectCode(
      finance.as.mutation(api.contacts.create, newContact(clientId, { email: 'x@y.co' })),
      'auth.forbidden',
    );
    const client = await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@portal.co' });
    await expectCode(client.as.query(api.contacts.listForClient, { clientId }), 'auth.forbidden');
    await expectCode(client.as.mutation(api.contacts.markLeft, { contactId: ada }), 'auth.forbidden');
  });

  it('records WhatsApp consent, and a new number withdraws it', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    const noNumber = await pm.as.mutation(api.contacts.create, newContact(clientId));
    await expectCode(
      pm.as.mutation(api.contacts.recordWhatsappOptIn, { contactId: noNumber, method: 'written_consent' }),
      'crm.invalid',
    );
    await pm.as.mutation(api.contacts.update, {
      contactId: noNumber,
      ...contactDetails({ whatsapp: '+2348012345678' }),
    });
    await pm.as.mutation(api.contacts.recordWhatsappOptIn, { contactId: noNumber, method: 'written_consent' });
    const [withConsent] = await pm.as.query(api.contacts.listForClient, { clientId });
    expect(withConsent.whatsappOptIn).toEqual({ at: Date.now(), method: 'written_consent' });

    await pm.as.mutation(api.contacts.update, {
      contactId: noNumber,
      ...contactDetails({ whatsapp: '+2348099999999' }),
    });
    expect((await pm.as.query(api.contacts.listForClient, { clientId }))[0].whatsappOptIn).toBeNull();
  });

  it('invites the first portal contact as Client admin and later ones as Client member', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    const ada = await pm.as.mutation(api.contacts.create, newContact(clientId));
    const bayo = await pm.as.mutation(
      api.contacts.create,
      newContact(clientId, { name: 'Bayo', email: 'bayo@glossup.com' }),
    );

    await pm.as.mutation(api.contacts.grantPortalAccess, { contactId: ada });
    await pm.as.mutation(api.contacts.grantPortalAccess, { contactId: bayo });
    await runScheduled();

    const [first, second] = await pm.as.query(api.contacts.listForClient, { clientId });
    expect([first.portalRole?.key, second.portalRole?.key]).toEqual(['client_admin', 'client_member']);
    expect(first.portalInviteLastSentAt).toBeTypeOf('number');
    expect((await pm.as.query(api.clients.get, { clientId })).portalEnabled).toBe(true);
    expect(vi.mocked(sendAuthEmail)).toHaveBeenCalledWith({
      kind: 'portalInvitation',
      to: 'ada@glossup.com',
      url: 'https://portal.unbuilt.studio/sign-in?email=ada%40glossup.com',
      inviterName: 'Tobi Ade',
      clientName: 'Glossup',
    });

    await expectCode(pm.as.mutation(api.contacts.grantPortalAccess, { contactId: ada }), 'crm.alreadyInvited');
    await expectCode(
      pm.as.mutation(api.contacts.setPortalRole, { contactId: bayo, roleId: roles.admin }),
      'crm.invalid',
    );
    await pm.as.mutation(api.contacts.setPortalRole, { contactId: bayo, roleId: roles.client_admin });
    await expectCode(
      pm.as.mutation(api.contacts.update, { contactId: ada, ...contactDetails({ email: 'new@glossup.com' }) }),
      'crm.emailLocked',
    );
  });

  it('refuses portal access for a team member’s address or one already on another client’s portal', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    const teamAddress = await pm.as.mutation(
      api.contacts.create,
      newContact(clientId, { email: 'kemi@unbuilt.studio' }),
    );
    await expectCode(pm.as.mutation(api.contacts.grantPortalAccess, { contactId: teamAddress }), 'crm.emailInUse');

    await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@glossup.com' });
    const elsewhere = await pm.as.mutation(api.contacts.create, newContact(clientId));
    await expectCode(pm.as.mutation(api.contacts.grantPortalAccess, { contactId: elsewhere }), 'crm.emailInUse');
  });

  it('marking a contact as left ends portal access immediately and keeps them on record', async () => {
    const portal = await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@portal.co' });
    await portal.as.query(portalOwnClient, {});
    await pm.as.mutation(api.contacts.markLeft, { contactId: portal.contactId });

    await expectCode(portal.as.query(portalOwnClient, {}), 'auth.unauthenticated');
    // A fresh session for the same account is refused too, because access is gone.
    const again = await createAuthSession(t, { email: 'ada-again@portal.co' });
    await t.run((ctx) => ctx.db.patch('contacts', portal.contactId, { authUserId: again.authUserId }));
    await expectCode(
      t.withIdentity({ subject: again.authUserId, sessionId: again.sessionId }).query(portalOwnClient, {}),
      'auth.forbidden',
    );

    const [left] = await pm.as.query(api.contacts.listForClient, { clientId: portal.clientId, includeLeft: true });
    expect(left).toMatchObject({ status: 'left', portalAccess: false, isPrimary: false, leftAt: Date.now() });
    expect(await pm.as.query(api.contacts.listForClient, { clientId: portal.clientId })).toEqual([]);
    await expectCode(pm.as.mutation(api.contacts.remove, { contactId: portal.contactId }), 'crm.hasHistory');
  });

  it('revoking portal access signs the contact out and removing a mistaken contact passes primary on', async () => {
    const portal = await createClientUser(t, roles.client_admin, { clientName: 'Portal Co', email: 'ada@portal.co' });
    await pm.as.mutation(api.contacts.revokePortalAccess, { contactId: portal.contactId });
    await expectCode(portal.as.query(portalOwnClient, {}), 'auth.unauthenticated');

    const clientId = await pm.as.mutation(api.clients.create, newClient());
    const typo = await pm.as.mutation(api.contacts.create, newContact(clientId, { email: 'ada@glosup.com' }));
    const real = await pm.as.mutation(api.contacts.create, newContact(clientId));
    await pm.as.mutation(api.contacts.remove, { contactId: typo });
    expect(await pm.as.query(api.contacts.listForClient, { clientId })).toMatchObject([{ id: real, isPrimary: true }]);
  });
});

describe('activity timeline', () => {
  it('lets anyone who can view the client add notes, with @mentions notifying active members', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    const contactId = await pm.as.mutation(api.contacts.create, newContact(clientId));
    await finance.as.mutation(api.activities.add, {
      subject: { table: 'contacts', id: contactId },
      type: 'call',
      body: `Called Ada about the overdue invoice. @[Tobi Ade](member:${pm.memberId}) please follow up.`,
    });

    const [note] = await t.run((ctx) =>
      ctx.db
        .query('notifications')
        .withIndex('by_recipient_created', (q) => q.eq('recipientKind', 'team').eq('recipientId', pm.memberId))
        .collect(),
    );
    expect(note).toMatchObject({
      event: 'mention',
      title: 'Funmi Finance mentioned you on Glossup',
      body: 'Called Ada about the overdue invoice. @Tobi Ade please follow up.',
      link: `/crm/clients/${clientId}`,
    });

    // The client's timeline includes its contacts' entries, newest first.
    const timeline = await timelineOf(clientId);
    expect(timeline.map((e) => e.title)).toEqual(['Call', 'Ada Obi added as a contact', 'Client created']);
    const contactTimeline = await pm.as.query(api.activities.list, {
      subject: { table: 'contacts', id: contactId },
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(contactTimeline.page.map((e) => e.title)).toEqual(['Call', 'Ada Obi added as a contact']);

    await expectCode(
      member.as.mutation(api.activities.add, { subject: { table: 'clients', id: clientId }, type: 'note', body: 'Hi' }),
      'auth.forbidden',
    );
    await expectCode(
      finance.as.mutation(api.activities.add, { subject: { table: 'clients', id: 'nope' }, type: 'note', body: 'Hi' }),
      'crm.notFound',
    );
  });

  it('lets authors edit and delete their own entries, Admins delete anyone’s, and nobody change automatic ones', async () => {
    const clientId = await pm.as.mutation(api.clients.create, newClient());
    const noteId = await finance.as.mutation(api.activities.add, {
      subject: { table: 'clients', id: clientId },
      type: 'note',
      body: 'Prefers invoices on the 1st',
    });

    await expectCode(pm.as.mutation(api.activities.update, { activityId: noteId, body: 'Changed' }), 'crm.cannotEdit');
    await expectCode(pm.as.mutation(api.activities.remove, { activityId: noteId }), 'crm.cannotDelete');
    await expectCode(
      admin.as.mutation(api.activities.update, { activityId: noteId, body: 'Changed' }),
      'crm.cannotEdit',
    );

    await finance.as.mutation(api.activities.update, {
      activityId: noteId,
      body: `Prefers invoices on the 1st @[Kemi Bello](member:${admin.memberId})`,
    });
    const [edited] = await timelineOf(clientId);
    expect(edited).toMatchObject({ editedAt: Date.now(), canEdit: false, canDelete: true });
    expect(await t.run((ctx) => ctx.db.query('notifications').collect())).toHaveLength(1);

    const created = (await timelineOf(clientId)).find((e) => e.title === 'Client created')!;
    await expectCode(admin.as.mutation(api.activities.remove, { activityId: created.id }), 'crm.cannotDelete');

    await admin.as.mutation(api.activities.remove, { activityId: noteId });
    expect((await timelineOf(clientId)).map((e) => e.title)).toEqual(['Client created']);
  });
});

describe('rate card', () => {
  const design = {
    name: 'Product design',
    unit: 'day' as const,
    prices: [
      { currency: 'USD' as const, unitPriceMinor: 60_000 },
      { currency: 'NGN' as const, unitPriceMinor: 45_000_000 },
    ],
    taxable: true,
  };

  it('lets ratecard.manage add and retire items, and ratecard.view read them', async () => {
    const itemId = await pm.as.mutation(api.rateCard.create, design);
    expect(await finance.as.query(api.rateCard.list, {})).toMatchObject([
      { id: itemId, prices: [{ currency: 'NGN' }, { currency: 'USD' }], active: true },
    ]);
    await expectCode(finance.as.mutation(api.rateCard.create, design), 'auth.forbidden');
    await expectCode(member.as.query(api.rateCard.list, {}), 'auth.forbidden');

    await pm.as.mutation(api.rateCard.setActive, { itemId, active: false });
    expect(await finance.as.query(api.rateCard.list, {})).toEqual([]);
    expect(await finance.as.query(api.rateCard.list, { includeInactive: true })).toHaveLength(1);

    await expectCode(
      pm.as.mutation(api.rateCard.update, {
        itemId,
        ...design,
        prices: [...design.prices, { currency: 'USD', unitPriceMinor: 1 }],
      }),
      'crm.invalid',
    );
    await expectCode(pm.as.mutation(api.rateCard.create, { ...design, serviceSlug: 'Web Platforms' }), 'crm.invalid');
  });
});
