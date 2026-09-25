import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { createClientUser, createTeamMember, newTest, type TestConvex } from './test.auth';

// A client admin managing their own people (12-client-portal.md, Team). What matters here: they reach only their own
// client, and no change they can make leaves the client with nobody able to approve or pay.

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
let admin: Awaited<ReturnType<typeof createClientUser>>;
let other: Awaited<ReturnType<typeof createClientUser>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-25T09:00:00Z'));
  t = newTest();
  await t.mutation(internal.seed.run, {});
  roles = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('roles').collect()).map((role) => [role.key, role._id])),
  );
  pm = await createTeamMember(t, roles.project_manager, { email: 'tobi@unbuilt.studio', name: 'Tobi Ade' });
  admin = await createClientUser(t, roles.client_admin, { clientName: 'Glossup', email: 'ada@glossup.com' });
  other = await createClientUser(t, roles.client_admin, { clientName: 'Qravit', email: 'bola@qravit.com' });
});

afterEach(() => {
  vi.useRealTimers();
});

const roleOf = async (contactId: Id<'contacts'>) =>
  await t.run(async (ctx) => {
    const contact = await ctx.db.get('contacts', contactId);
    return contact?.portalRoleId ? (await ctx.db.get('roles', contact.portalRoleId))?.key : null;
  });

describe('inviting a colleague', () => {
  it('adds somebody the studio has never met, and sends them a link', async () => {
    const { contactId } = await admin.as.mutation(api.portalColleagues.invite, {
      name: 'Kunle Bakare',
      email: 'Kunle@Glossup.com',
      jobTitle: 'Finance',
      role: 'client_member',
    });

    expect(await t.run((ctx) => ctx.db.get('contacts', contactId))).toMatchObject({
      clientId: admin.clientId,
      name: 'Kunle Bakare',
      // Lowercased, because sign-in matches on the address.
      email: 'kunle@glossup.com',
      portalAccess: true,
    });
    expect(await roleOf(contactId)).toBe('client_member');

    const listed = await admin.as.query(api.portalColleagues.list, {});
    expect(listed.map((row) => row.email).sort()).toEqual(['ada@glossup.com', 'kunle@glossup.com']);
    expect(listed.find((row) => row.email === 'ada@glossup.com')).toMatchObject({ isYou: true, role: 'client_admin' });
  });

  it('gives access to a contact the studio already holds, rather than adding a second one', async () => {
    const existing = await pm.as.mutation(api.contacts.create, {
      clientId: admin.clientId,
      name: 'Bisi Accounts',
      email: 'accounts@glossup.com',
      isBilling: true,
    });
    const { contactId } = await admin.as.mutation(api.portalColleagues.invite, {
      name: 'Bisi Accounts',
      email: 'accounts@glossup.com',
      role: 'client_admin',
    });
    expect(contactId).toBe(existing);
    expect(await t.run((ctx) => ctx.db.query('contacts').collect())).toHaveLength(3);
  });

  it('refuses an address that belongs to Unbuilt, or already signs in elsewhere', async () => {
    await expectCode(
      admin.as.mutation(api.portalColleagues.invite, {
        name: 'Tobi',
        email: 'tobi@unbuilt.studio',
        role: 'client_member',
      }),
      'crm.emailInUse',
    );
    await expectCode(
      admin.as.mutation(api.portalColleagues.invite, {
        name: 'Bola',
        email: 'bola@qravit.com',
        role: 'client_member',
      }),
      'crm.emailInUse',
    );
    await expectCode(
      admin.as.mutation(api.portalColleagues.invite, { name: 'Nobody', email: 'not-an-email', role: 'client_member' }),
      'crm.invalid',
    );
  });
});

describe('who can act for the client', () => {
  async function colleague(role: 'client_admin' | 'client_member' = 'client_member') {
    const { contactId } = await admin.as.mutation(api.portalColleagues.invite, {
      name: 'Kunle Bakare',
      email: 'kunle@glossup.com',
      role,
    });
    return contactId;
  }

  it('promotes and demotes, while an admin remains', async () => {
    const contactId = await colleague();
    await admin.as.mutation(api.portalColleagues.setRole, { contactId, role: 'client_admin' });
    expect(await roleOf(contactId)).toBe('client_admin');
    await admin.as.mutation(api.portalColleagues.setRole, { contactId, role: 'client_member' });
    expect(await roleOf(contactId)).toBe('client_member');
  });

  it('will not let the only admin step down, since nobody would be left to put it right', async () => {
    await expectCode(
      admin.as.mutation(api.portalColleagues.setRole, { contactId: admin.contactId, role: 'client_member' }),
      'crm.lastAdmin',
    );
    // Nor can the only admin be taken off by anyone else, for the same reason.
    const contactId = await colleague();
    await admin.as.mutation(api.portalColleagues.setRole, { contactId, role: 'client_admin' });
    await admin.as.mutation(api.portalColleagues.setRole, { contactId, role: 'client_member' });
    expect(await roleOf(admin.contactId)).toBe('client_admin');
  });

  it('lets an admin step down once somebody else can carry it, and then stops offering them the page', async () => {
    await colleague('client_admin');
    await admin.as.mutation(api.portalColleagues.setRole, { contactId: admin.contactId, role: 'client_member' });
    expect(await roleOf(admin.contactId)).toBe('client_member');
    // They gave the job away, so the page is no longer theirs — which is the point of giving it away.
    await expectCode(admin.as.query(api.portalColleagues.list, {}), 'auth.forbidden');
  });

  it('takes access away without deleting who they were', async () => {
    const contactId = await colleague();
    await admin.as.mutation(api.portalColleagues.revoke, { contactId });
    const after = await t.run((ctx) => ctx.db.get('contacts', contactId));
    // The role is taken off the record entirely rather than left pointing at something.
    expect(after?.portalRoleId).toBeUndefined();
    expect(after).toMatchObject({
      portalAccess: false,
      // The studio still needs to know who they were dealing with.
      name: 'Kunle Bakare',
      status: 'active',
    });
  });

  it('will not let somebody lock themselves out', async () => {
    await expectCode(admin.as.mutation(api.portalColleagues.revoke, { contactId: admin.contactId }), 'crm.notYourself');
  });

  it('reaches nobody at another client', async () => {
    await expectCode(admin.as.mutation(api.portalColleagues.revoke, { contactId: other.contactId }), 'crm.notFound');
    await expectCode(
      admin.as.mutation(api.portalColleagues.setRole, { contactId: other.contactId, role: 'client_member' }),
      'crm.notFound',
    );
    expect(await admin.as.query(api.portalColleagues.list, {})).toHaveLength(1);
  });

  it('is not open to a client member, nor to the studio’s own people', async () => {
    const contactId = await colleague();
    const member = await createClientUser(t, roles.client_member, {
      clientName: 'unused',
      email: 'junior@glossup.com',
    });
    await t.run(async (ctx) => ctx.db.patch('contacts', member.contactId, { clientId: admin.clientId }));
    await expectCode(member.as.query(api.portalColleagues.list, {}), 'auth.forbidden');
    await expectCode(member.as.mutation(api.portalColleagues.revoke, { contactId }), 'auth.forbidden');
    await expectCode(pm.as.query(api.portalColleagues.list, {}), 'auth.forbidden');
  });
});
