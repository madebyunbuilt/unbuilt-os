import { ConvexError, v } from 'convex/values';
import { type Id } from './_generated/dataModel';
import { type MutationCtx } from './_generated/server';
import { auditedDatabase } from './lib/audit';
import { internalMutation } from './lib/functions';
import { DEFAULT_LOST_REASONS, DEFAULT_PIPELINE_STAGES } from './lib/deals';
import { ensureSeededHolidays } from './lib/holidays';
import { DEFAULT_ROLES, OWNER_ROLE_KEY } from './lib/permissions';
import { normalizeEmail } from './lib/principals';
import { DEFAULT_ORG_SETTINGS } from './lib/settings';
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_SLA_POLICY_NAMES,
  DEFAULT_SLA_TARGETS,
  SAMPLE_CLIENTS,
  SAMPLE_TEAM,
} from './lib/seedData';

// The seed (02-architecture.md, Environments). Idempotent: it only adds what is missing and never changes or removes a
// row that exists, so edits made in the app survive a re-run.
//
//   pnpm convex run seed:run '{"ownerEmail":"owner@unbuilt.studio","ownerName":"Owner"}'
//   pnpm convex run seed:run '{"includeSampleData":true}'   # development, with ALLOW_SAMPLE_DATA=true only

type Db = MutationCtx['db'];

async function seedRoles(db: Db) {
  const ids = new Map<string, Id<'roles'>>();
  let created = 0;
  for (const role of DEFAULT_ROLES) {
    const existing = await db
      .query('roles')
      .withIndex('by_key', (q) => q.eq('key', role.key))
      .unique();
    if (existing) {
      ids.set(role.key, existing._id);
      continue;
    }
    ids.set(role.key, await db.insert('roles', { ...role, permissions: [...role.permissions], isSystem: true }));
    created++;
  }
  return { ids, created };
}

async function seedOrgSettings(db: Db) {
  if (await db.query('orgSettings').first()) return { created: 0 };
  await db.insert('orgSettings', DEFAULT_ORG_SETTINGS);
  return { created: 1 };
}

async function seedBusinessHours(db: Db) {
  const existing = await db
    .query('businessHours')
    .withIndex('by_default', (q) => q.eq('isDefault', true))
    .first();
  if (existing) return { id: existing._id, created: 0 };
  const id = await db.insert('businessHours', {
    ...DEFAULT_BUSINESS_HOURS,
    weekly: DEFAULT_BUSINESS_HOURS.weekly.map((hours) => ({ ...hours })),
    isDefault: true,
  });
  return { id, created: 1 };
}

/** The calendar year in Lagos, which decides "current and next year". */
export function lagosYear(now: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric' }).format(now));
}

/** The default pipeline and lost reasons (05-crm.md), only when none exist, so edits in the app are kept. */
async function seedPipeline(db: Db) {
  let created = 0;
  if (!(await db.query('pipelineStages').first())) {
    for (const [order, stage] of DEFAULT_PIPELINE_STAGES.entries()) {
      await db.insert('pipelineStages', { ...stage, order });
      created++;
    }
  }
  if (!(await db.query('lostReasons').first())) {
    for (const [order, label] of DEFAULT_LOST_REASONS.entries()) {
      await db.insert('lostReasons', { label, order, active: true });
      created++;
    }
  }
  return { created };
}

async function seedSlaPolicies(db: Db, businessHoursId: Id<'businessHours'>) {
  let created = 0;
  for (const name of DEFAULT_SLA_POLICY_NAMES) {
    const existing = await db
      .query('slaPolicies')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first();
    if (existing) continue;
    await db.insert('slaPolicies', {
      name,
      businessHoursId,
      targets: DEFAULT_SLA_TARGETS.map((target) => ({ ...target })),
      active: true,
    });
    created++;
  }
  return { created };
}

async function seedOwnerInvite(db: Db, ownerRoleId: Id<'roles'>, owner: { email: string; name: string } | undefined) {
  const existingOwner = await db
    .query('teamMembers')
    .withIndex('by_role', (q) => q.eq('roleId', ownerRoleId))
    .first();
  if (existingOwner) return { created: 0, ownerEmail: existingOwner.email };
  if (!owner) return { created: 0, ownerEmail: null };

  const email = normalizeEmail(owner.email);
  const sameEmail = await db
    .query('teamMembers')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first();
  if (sameEmail) {
    throw new ConvexError({
      code: 'seed.ownerConflict',
      message: `${email} is already a team member without the Owner role; change their role in the app instead`,
    });
  }
  await db.insert('teamMembers', {
    name: owner.name,
    email,
    employmentType: 'employee',
    roleId: ownerRoleId,
    status: 'invited',
    timezone: 'Africa/Lagos',
    skills: [],
  });
  return { created: 1, ownerEmail: email };
}

async function seedSampleData(db: Db, roleIds: Map<string, Id<'roles'>>) {
  let created = 0;
  for (const person of SAMPLE_TEAM) {
    const exists = await db
      .query('teamMembers')
      .withIndex('by_email', (q) => q.eq('email', person.email))
      .first();
    if (exists) continue;
    await db.insert('teamMembers', {
      name: person.name,
      email: person.email,
      title: person.title,
      employmentType: 'employee',
      roleId: roleIds.get(person.roleKey)!,
      status: 'invited',
      timezone: 'Africa/Lagos',
      skills: [],
    });
    created++;
  }

  for (const sample of SAMPLE_CLIENTS) {
    const exists = (await db.query('clients').collect()).some((client) => client.displayName === sample.displayName);
    if (exists) continue;
    const clientId = await db.insert('clients', {
      displayName: sample.displayName,
      kind: 'company',
      status: 'active',
      country: 'NG',
      defaultCurrency: 'NGN',
      timezone: 'Africa/Lagos',
      portalEnabled: true,
    });
    created++;
    for (const [index, contact] of sample.contacts.entries()) {
      await db.insert('contacts', {
        clientId,
        name: contact.name,
        email: contact.email,
        isPrimary: index === 0,
        isBilling: contact.isBilling,
        portalAccess: true,
        portalRoleId: roleIds.get(contact.roleKey)!,
        status: 'active',
      });
      created++;
    }
  }
  return { created };
}

export const run = internalMutation({
  args: {
    ownerEmail: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    includeSampleData: v.optional(v.boolean()),
  },
  handler: async (ctx, { ownerEmail, ownerName, includeSampleData }) => {
    if (includeSampleData && process.env.ALLOW_SAMPLE_DATA !== 'true') {
      throw new ConvexError({
        code: 'seed.sampleDataNotAllowed',
        message: 'Sample data is for development deployments with ALLOW_SAMPLE_DATA=true',
      });
    }
    if (ownerEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      throw new ConvexError({ code: 'seed.invalidEmail', message: `"${ownerEmail}" is not an email address` });
    }

    // Seed writes are audited like any other, as the system.
    const db = auditedDatabase(ctx.db, { actorKind: 'system', permission: 'seed' });
    const year = lagosYear(Date.now());

    const roles = await seedRoles(db);
    const orgSettings = await seedOrgSettings(db);
    const businessHours = await seedBusinessHours(db);
    const holidays = await ensureSeededHolidays(db, [year, year + 1]);
    const slaPolicies = await seedSlaPolicies(db, businessHours.id);
    const pipeline = await seedPipeline(db);
    const owner = await seedOwnerInvite(
      db,
      roles.ids.get(OWNER_ROLE_KEY)!,
      ownerEmail ? { email: ownerEmail, name: ownerName?.trim() || ownerEmail.trim() } : undefined,
    );
    const sample = includeSampleData ? await seedSampleData(db, roles.ids) : { created: 0 };

    return {
      created: {
        roles: roles.created,
        orgSettings: orgSettings.created,
        businessHours: businessHours.created,
        holidays: holidays.created,
        slaPolicies: slaPolicies.created,
        pipeline: pipeline.created,
        ownerInvite: owner.created,
        sampleRecords: sample.created,
      },
      ownerEmail: owner.ownerEmail,
      warnings: [
        ...(owner.ownerEmail ? [] : ['No Owner exists yet. Run again with ownerEmail to invite one.']),
        ...holidays.yearsWithoutEstimates.map(
          (y) => `No movable holiday estimates for ${y}; add Easter, Eid and Mawlid dates manually.`,
        ),
        'Movable holidays are estimates. Confirm the declared dates in Settings.',
        ...(orgSettings.created ? ['Fill in the legal name, TIN, bank accounts and payment terms in Settings.'] : []),
      ],
    };
  },
});
