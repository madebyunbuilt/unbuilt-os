import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Field contract: docs/spec/04-data-model.md. Tables arrive with the pull requests that use them; fields a later module
// owns are added by that module.

const currency = v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'));

const numberFormat = v.object({ prefix: v.string(), padding: v.number() });

export default defineSchema({
  // Single row. Missing optional values are set by the studio in Settings; see 18-open-questions.md for defaults.
  orgSettings: defineTable({
    legalName: v.optional(v.string()),
    tradingName: v.optional(v.string()),
    addressLines: v.array(v.string()),
    country: v.string(),
    tin: v.optional(v.string()),
    vatNumber: v.optional(v.string()),
    defaultCurrency: currency,
    timezone: v.string(),
    logoFileId: v.optional(v.id('files')),
    // Sensitive: only returned with settings.billing.sensitive, redacted in audit diffs.
    bankAccounts: v.array(
      v.object({
        label: v.string(),
        currency,
        bankName: v.string(),
        accountName: v.string(),
        accountNumber: v.string(),
        swift: v.optional(v.string()),
        iban: v.optional(v.string()),
        sortCode: v.optional(v.string()),
      }),
    ),
    // Overrides of DEFAULT_NUMBERING in convex/lib/numbering.ts, keyed by record type.
    numbering: v.record(v.string(), numberFormat),
    defaultPaymentTermsDays: v.optional(v.number()),
    defaultVatBps: v.number(),
    lateFeePolicy: v.object({ enabled: v.boolean(), monthlyBps: v.number(), graceDays: v.optional(v.number()) }),
    invoiceFooter: v.optional(v.string()),
    quoteValidityDays: v.optional(v.number()),
    retentionYears: v.number(),
    brand: v.object({ primary: v.string(), accent: v.string() }),
  }),

  files: defineTable({
    storageId: v.id('_storage'),
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    // Hex SHA-256 of the stored bytes, from Convex storage.
    sha256: v.string(),
    owner: v.object({ table: v.string(), id: v.string() }),
    clientId: v.optional(v.id('clients')),
    projectId: v.optional(v.string()),
    visibility: v.union(v.literal('internal'), v.literal('client')),
    uploadedByKind: v.union(v.literal('team'), v.literal('client'), v.literal('system')),
    uploadedById: v.string(),
  })
    .index('by_owner', ['owner.table', 'owner.id'])
    .index('by_client', ['clientId'])
    .index('by_storage', ['storageId']),

  counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index('by_key', ['key']),

  businessHours: defineTable({
    name: v.string(),
    timezone: v.string(),
    weekly: v.array(v.object({ day: v.number(), start: v.string(), end: v.string() })),
    isDefault: v.boolean(),
  }).index('by_default', ['isDefault']),

  holidays: defineTable({
    date: v.string(),
    name: v.string(),
    country: v.string(),
    recurring: v.boolean(),
    source: v.union(v.literal('seed'), v.literal('manual')),
    // Movable holidays (Easter, Eids, Mawlid) are seeded as estimates until an admin confirms the declared date.
    needsConfirmation: v.boolean(),
  }).index('by_date', ['date']),

  slaPolicies: defineTable({
    name: v.string(),
    businessHoursId: v.id('businessHours'),
    targets: v.array(
      v.object({
        priority: v.union(v.literal('p1'), v.literal('p2'), v.literal('p3'), v.literal('p4')),
        firstResponseMinutes: v.number(),
        // Absent means best effort.
        resolutionMinutes: v.optional(v.number()),
      }),
    ),
    includedMinutesPerMonth: v.optional(v.number()),
    uptimeTargetBps: v.optional(v.number()),
    active: v.boolean(),
  }).index('by_name', ['name']),

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
    avatarFileId: v.optional(v.id('files')),
    // Invitations (11-team.md): an invite stops working at inviteExpiresAt; resending renews it. The seeded Owner invite
    // has no expiry.
    invitedByMemberId: v.optional(v.id('teamMembers')),
    inviteExpiresAt: v.optional(v.number()),
    inviteLastSentAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    offboardedAt: v.optional(v.number()),
  })
    .index('by_authUser', ['authUserId'])
    .index('by_email', ['email'])
    .index('by_status', ['status'])
    .index('by_role', ['roleId']),

  timeOff: defineTable({
    memberId: v.id('teamMembers'),
    type: v.union(v.literal('annual'), v.literal('sick'), v.literal('public'), v.literal('unpaid'), v.literal('other')),
    // YYYY-MM-DD in the studio's timezone, inclusive
    startDate: v.string(),
    endDate: v.string(),
    // Only for a single day
    halfDay: v.boolean(),
    status: v.union(v.literal('requested'), v.literal('approved'), v.literal('declined'), v.literal('cancelled')),
    // The type, note and decision note are private to the member and approvers (sick leave is health information).
    note: v.optional(v.string()),
    // Who entered it: the member, or an approver logging it for them
    requestedBy: v.id('teamMembers'),
    decidedBy: v.optional(v.id('teamMembers')),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    cancelledBy: v.optional(v.id('teamMembers')),
    cancelledAt: v.optional(v.number()),
  })
    .index('by_member_start', ['memberId', 'startDate'])
    .index('by_status_end', ['status', 'endDate']),

  clients: defineTable({
    displayName: v.string(),
    legalName: v.optional(v.string()),
    kind: v.union(v.literal('company'), v.literal('individual')),
    status: v.union(v.literal('lead'), v.literal('active'), v.literal('past'), v.literal('archived')),
    industry: v.optional(v.string()),
    website: v.optional(v.string()),
    country: v.optional(v.string()),
    // Optional so rows created before CRM stay valid; read absent as empty.
    addressLines: v.optional(v.array(v.string())),
    tin: v.optional(v.string()),
    // Absent means standard. Edited with invoices.update (billing details).
    vatTreatment: v.optional(v.union(v.literal('standard'), v.literal('zero_rated'), v.literal('exempt'))),
    whtApplies: v.optional(v.boolean()),
    whtBps: v.optional(v.number()),
    defaultCurrency: currency,
    paymentTermsDays: v.optional(v.number()),
    timezone: v.string(),
    ownerMemberId: v.optional(v.id('teamMembers')),
    source: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    slaPolicyId: v.optional(v.id('slaPolicies')),
    portalEnabled: v.boolean(),
  })
    .index('by_status', ['status'])
    .index('by_owner', ['ownerMemberId'])
    .searchIndex('search_displayName', { searchField: 'displayName', filterFields: ['status'] }),

  contacts: defineTable({
    clientId: v.id('clients'),
    name: v.string(),
    // Lowercase
    email: v.string(),
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    // No WhatsApp message is sent without this (14-platform.md).
    whatsappOptIn: v.optional(
      v.object({
        at: v.number(),
        method: v.union(v.literal('portal_checkbox'), v.literal('written_consent'), v.literal('form')),
        recordedBy: v.optional(v.id('teamMembers')),
      }),
    ),
    jobTitle: v.optional(v.string()),
    isPrimary: v.boolean(),
    isBilling: v.boolean(),
    portalAccess: v.boolean(),
    portalRoleId: v.optional(v.id('roles')),
    portalInvitedAt: v.optional(v.number()),
    portalInviteLastSentAt: v.optional(v.number()),
    authUserId: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('left')),
    leftAt: v.optional(v.number()),
  })
    .index('by_client', ['clientId'])
    .index('by_email', ['email'])
    .index('by_authUser', ['authUserId'])
    .index('by_portalRole', ['portalRoleId'])
    .searchIndex('search_name', { searchField: 'name', filterFields: ['clientId'] })
    .searchIndex('search_email', { searchField: 'email', filterFields: ['clientId'] }),

  activities: defineTable({
    subject: v.object({
      table: v.union(
        v.literal('clients'),
        v.literal('contacts'),
        v.literal('deals'),
        v.literal('projects'),
        v.literal('tickets'),
      ),
      id: v.string(),
    }),
    // The client the subject belongs to, so a client's timeline includes its contacts, deals, projects and tickets.
    clientId: v.optional(v.id('clients')),
    type: v.union(
      v.literal('note'),
      v.literal('call'),
      v.literal('meeting'),
      v.literal('email_sent'),
      v.literal('email_received'),
      v.literal('whatsapp_sent'),
      v.literal('status_change'),
      v.literal('document_event'),
      v.literal('payment_event'),
      v.literal('system'),
    ),
    title: v.string(),
    body: v.optional(v.string()),
    actorKind: v.union(v.literal('team'), v.literal('client'), v.literal('system')),
    actorId: v.optional(v.string()),
    occurredAt: v.number(),
    // Members @mentioned in a note, call or meeting
    mentions: v.optional(v.array(v.id('teamMembers'))),
    editedAt: v.optional(v.number()),
    meta: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))),
  })
    .index('by_subject_occurred', ['subject.table', 'subject.id', 'occurredAt'])
    .index('by_client_occurred', ['clientId', 'occurredAt']),

  rateCardItems: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    serviceSlug: v.optional(v.string()),
    unit: v.union(v.literal('fixed'), v.literal('hour'), v.literal('day'), v.literal('week'), v.literal('month')),
    // At most one price per currency; never converted between currencies.
    prices: v.array(v.object({ currency, unitPriceMinor: v.number() })),
    taxable: v.boolean(),
    active: v.boolean(),
    category: v.optional(v.string()),
  })
    .index('by_active_name', ['active', 'name'])
    .index('by_name', ['name']),

  notifications: defineTable({
    recipientKind: v.union(v.literal('team'), v.literal('client')),
    // teamMembers or contacts id, depending on recipientKind
    recipientId: v.string(),
    event: v.string(),
    title: v.string(),
    body: v.string(),
    // An in-app path, e.g. /billing/invoices/abc
    link: v.optional(v.string()),
    readAt: v.optional(v.number()),
    channels: v.object({ inApp: v.boolean(), email: v.optional(v.boolean()), whatsapp: v.optional(v.boolean()) }),
    createdAt: v.number(),
  })
    .index('by_recipient_read', ['recipientKind', 'recipientId', 'readAt', 'createdAt'])
    .index('by_recipient_created', ['recipientKind', 'recipientId', 'createdAt']),

  checklists: defineTable({
    kind: v.union(v.literal('onboarding'), v.literal('handover'), v.literal('offboarding_member'), v.literal('custom')),
    target: v.object({ table: v.string(), id: v.string() }),
    items: v.array(
      v.object({
        label: v.string(),
        // Items with a key are ticked by the system (for example twoFactor); the rest by people.
        key: v.optional(v.string()),
        done: v.boolean(),
        doneBy: v.optional(v.id('teamMembers')),
        doneAt: v.optional(v.number()),
        required: v.boolean(),
      }),
    ),
  }).index('by_target', ['target.table', 'target.id', 'kind']),

  // When a person last used the app in a session: clicks, typing, scrolling, touches. Token renewals do not count.
  // Team sessions end after 12 hours without it (03-auth-and-permissions.md). Not audited; cleared daily.
  sessionActivity: defineTable({
    sessionId: v.string(),
    authUserId: v.string(),
    lastActiveAt: v.number(),
  })
    .index('by_session', ['sessionId'])
    .index('by_lastActive', ['lastActiveAt']),

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
