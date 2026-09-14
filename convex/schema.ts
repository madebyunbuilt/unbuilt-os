import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Field contract: docs/spec/04-data-model.md. Tables arrive with the pull requests that use them; fields a later module
// owns are added by that module.

const currency = v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'));

export default defineSchema({
  counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index('by_key', ['key']),

  roles: defineTable({
    key: v.string(),
    name: v.string(),
    kind: v.union(v.literal('team'), v.literal('client')),
    permissions: v.array(v.string()),
    isSystem: v.boolean(),
    description: v.string(),
  })
    .index('by_kind', ['kind'])
    .index('by_key', ['key']),

  teamMembers: defineTable({
    authUserId: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    title: v.optional(v.string()),
    employmentType: v.union(v.literal('employee'), v.literal('contractor')),
    roleId: v.id('roles'),
    status: v.union(v.literal('invited'), v.literal('active'), v.literal('suspended'), v.literal('offboarded')),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    costRateMinor: v.optional(v.number()),
    billRateMinor: v.optional(v.number()),
    rateCurrency: v.optional(currency),
    capacityMinutesPerWeek: v.optional(v.number()),
    timezone: v.string(),
    skills: v.array(v.string()),
  })
    .index('by_authUser', ['authUserId'])
    .index('by_email', ['email'])
    .index('by_status', ['status'])
    .index('by_role', ['roleId']),

  clients: defineTable({
    displayName: v.string(),
    legalName: v.optional(v.string()),
    kind: v.union(v.literal('company'), v.literal('individual')),
    status: v.union(v.literal('lead'), v.literal('active'), v.literal('past'), v.literal('archived')),
    country: v.optional(v.string()),
    defaultCurrency: currency,
    timezone: v.string(),
    portalEnabled: v.boolean(),
  })
    .index('by_status', ['status'])
    .searchIndex('search_displayName', { searchField: 'displayName' }),

  contacts: defineTable({
    clientId: v.id('clients'),
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    isPrimary: v.boolean(),
    isBilling: v.boolean(),
    portalAccess: v.boolean(),
    portalRoleId: v.optional(v.id('roles')),
    authUserId: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('left')),
  })
    .index('by_client', ['clientId'])
    .index('by_email', ['email'])
    .index('by_authUser', ['authUserId'])
    .index('by_portalRole', ['portalRoleId'])
    .searchIndex('search_name', { searchField: 'name', filterFields: ['clientId'] }),

  // Append-only. Written only by convex/lib/audit.ts; no function updates or deletes an entry.
  auditLog: defineTable({
    actorKind: v.union(v.literal('team'), v.literal('client'), v.literal('system')),
    actorId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
    permission: v.optional(v.string()),
    action: v.union(v.literal('insert'), v.literal('update'), v.literal('delete'), v.literal('read')),
    table: v.string(),
    recordId: v.string(),
    diff: v.object({ before: v.optional(v.any()), after: v.optional(v.any()) }),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    at: v.number(),
  })
    .index('by_target', ['table', 'recordId', 'at'])
    .index('by_actor_at', ['actorId', 'at'])
    .index('by_at', ['at']),
});
