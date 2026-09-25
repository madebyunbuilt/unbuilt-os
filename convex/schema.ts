import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { blockValidator, documentType } from './lib/documentBlocks';

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
    // On documents and invoices, so a client can reply to a real address.
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
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
    lateFeePolicy: v.object({
      enabled: v.boolean(),
      monthlyBps: v.number(),
      graceDays: v.optional(v.number()),
      // Late fees wait as drafts for Finance unless this is on (08-billing-and-finance.md, Late fees).
      autoSend: v.optional(v.boolean()),
    }),
    invoiceFooter: v.optional(v.string()),
    quoteValidityDays: v.optional(v.number()),
    // 08-billing-and-finance.md, Expenses: what a billable expense is recharged at. Unset means at cost.
    expenseMarkupBps: v.optional(v.number()),
    // 06-projects.md, Change requests: at or above this, in the studio's own currency, a change request is approved by
    // signature rather than by a click. Unset means the default in convex/lib/changeRequests.ts.
    changeRequestSignatureMinor: v.optional(v.number()),
    retentionYears: v.number(),
    brand: v.object({ primary: v.string(), accent: v.string() }),
    // 07-documents-and-esign.md, Legal note: stays off until the Owner records that counsel reviewed the signing process.
    signatureProcessReview: v.optional(
      v.object({ reviewedAt: v.number(), reviewedByMemberId: v.id('teamMembers'), note: v.optional(v.string()) }),
    ),
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
    // No invoice reminders to this client (08-billing-and-finance.md, Reminders).
    noReminders: v.optional(v.boolean()),
    // How this client approves change requests: by the studio's threshold unless they always or never sign.
    changeRequestSignature: v.optional(v.union(v.literal('threshold'), v.literal('always'), v.literal('never'))),
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

  enquiries: defineTable({
    source: v.union(v.literal('website'), v.literal('manual'), v.literal('email'), v.literal('referral')),
    name: v.string(),
    // Lowercase
    email: v.string(),
    company: v.optional(v.string()),
    // Website service slugs, e.g. web, mobile, design
    services: v.array(v.string()),
    // The website form's option ids (convex/lib/enquiries.ts has the labels)
    stage: v.optional(v.string()),
    budget: v.optional(v.string()),
    timeline: v.optional(v.string()),
    about: v.optional(v.string()),
    status: v.union(
      v.literal('new'),
      v.literal('reviewed'),
      v.literal('converted'),
      v.literal('spam'),
      v.literal('closed'),
    ),
    clientId: v.optional(v.id('clients')),
    dealId: v.optional(v.id('deals')),
    // Personal data kept for abuse checks; shown only with audit.view.
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    turnstilePassed: v.boolean(),
    receivedAt: v.number(),
    // Team member who entered a manual, email or referral enquiry
    createdBy: v.optional(v.id('teamMembers')),
    decidedBy: v.optional(v.id('teamMembers')),
    decidedAt: v.optional(v.number()),
  })
    .index('by_status_received', ['status', 'receivedAt'])
    .index('by_email', ['email']),

  // Fixed-window counters for public endpoints, e.g. key "enquiry:ip:203.0.113.7".
  publicRateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_windowStart', ['windowStart']),

  pipelineStages: defineTable({
    name: v.string(),
    order: v.number(),
    probabilityBps: v.number(),
    kind: v.union(v.literal('open'), v.literal('won'), v.literal('lost')),
  }).index('by_order', ['order']),

  lostReasons: defineTable({
    label: v.string(),
    order: v.number(),
    active: v.boolean(),
  }).index('by_order', ['order']),

  deals: defineTable({
    title: v.string(),
    clientId: v.id('clients'),
    primaryContactId: v.optional(v.id('contacts')),
    stageId: v.id('pipelineStages'),
    valueMinor: v.number(),
    currency,
    probabilityBps: v.number(),
    // YYYY-MM-DD
    expectedCloseDate: v.optional(v.string()),
    ownerMemberId: v.id('teamMembers'),
    services: v.array(v.string()),
    source: v.optional(v.string()),
    enquiryId: v.optional(v.id('enquiries')),
    lostReasonId: v.optional(v.id('lostReasons')),
    lostNote: v.optional(v.string()),
    wonAt: v.optional(v.number()),
    lostAt: v.optional(v.number()),
    // YYYY-MM-DD in the studio's timezone
    nextFollowUpDate: v.optional(v.string()),
    // Latest timeline entry on the deal; starts at creation
    lastActivityAt: v.number(),
    // Follow-up reminders already sent, so each fires once (05-crm.md, Follow-ups)
    idleNotifiedAt: v.optional(v.number()),
    followUpNotifiedFor: v.optional(v.string()),
  })
    .index('by_stage', ['stageId'])
    .index('by_client', ['clientId'])
    .index('by_owner_followup', ['ownerMemberId', 'nextFollowUpDate'])
    .index('by_enquiry', ['enquiryId']),

  projects: defineTable({
    code: v.string(),
    name: v.string(),
    clientId: v.id('clients'),
    dealId: v.optional(v.id('deals')),
    templateId: v.optional(v.id('projectTemplates')),
    type: v.union(
      v.literal('mobile_app'),
      v.literal('web_platform'),
      v.literal('product_design'),
      v.literal('backend'),
      v.literal('devops'),
      v.literal('video'),
      v.literal('dev_tool'),
      v.literal('retainer'),
      v.literal('other'),
    ),
    status: v.union(
      v.literal('planning'),
      v.literal('active'),
      v.literal('on_hold'),
      v.literal('completed'),
      v.literal('cancelled'),
      v.literal('archived'),
    ),
    billingModel: v.union(v.literal('fixed'), v.literal('time_and_materials'), v.literal('retainer')),
    budgetMinor: v.optional(v.number()),
    currency,
    // YYYY-MM-DD
    startDate: v.string(),
    dueDate: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    managerMemberId: v.id('teamMembers'),
    contractDocumentId: v.optional(v.string()),
    slaPolicyId: v.optional(v.id('slaPolicies')),
    links: v.object({
      repo: v.optional(v.string()),
      staging: v.optional(v.string()),
      production: v.optional(v.string()),
      design: v.optional(v.string()),
    }),
    description: v.optional(v.string()),
    handoverStatus: v.union(v.literal('not_started'), v.literal('in_progress'), v.literal('complete')),
  })
    .index('by_client', ['clientId'])
    .index('by_status', ['status'])
    .index('by_manager', ['managerMemberId'])
    .index('by_code', ['code'])
    .index('by_deal', ['dealId'])
    .searchIndex('search_name', { searchField: 'name' }),

  projectMembers: defineTable({
    projectId: v.id('projects'),
    memberId: v.id('teamMembers'),
    // A label such as lead developer; it grants nothing.
    projectRole: v.optional(v.string()),
    joinedAt: v.number(),
  })
    .index('by_project', ['projectId'])
    .index('by_member', ['memberId'])
    .index('by_project_member', ['projectId', 'memberId']),

  projectTemplates: defineTable({
    name: v.string(),
    type: v.string(),
    description: v.optional(v.string()),
    milestones: v.array(
      v.object({
        name: v.string(),
        // Days after the project start
        offsetDays: v.number(),
        // Used by billing schedules (billing automation step)
        billingPercentBps: v.optional(v.number()),
        deliverables: v.array(v.string()),
      }),
    ),
    tasks: v.array(
      v.object({ title: v.string(), milestoneIndex: v.optional(v.number()), estimateMinutes: v.optional(v.number()) }),
    ),
    intakeFormId: v.optional(v.string()),
    checklists: v.array(v.object({ kind: v.string(), items: v.array(v.string()) })),
    active: v.boolean(),
  }).index('by_name', ['name']),

  milestones: defineTable({
    projectId: v.id('projects'),
    name: v.string(),
    order: v.number(),
    dueDate: v.optional(v.string()),
    status: v.union(
      v.literal('upcoming'),
      v.literal('in_progress'),
      v.literal('awaiting_approval'),
      v.literal('approved'),
      v.literal('invoiced'),
      v.literal('skipped'),
    ),
    billingAmountMinor: v.optional(v.number()),
    billingPercentBps: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedByContactId: v.optional(v.id('contacts')),
  }).index('by_project_order', ['projectId', 'order']),

  // A priced change to agreed scope (06-projects.md, Change requests). The client approves it — by signature above the
  // studio's threshold — and approval moves the project's budget and due date and bills the amount, exactly once.
  changeRequests: defineTable({
    number: v.optional(v.string()),
    projectId: v.id('projects'),
    clientId: v.id('clients'),
    title: v.string(),
    description: v.string(),
    reason: v.string(),
    impact: v.object({ amountMinor: v.number(), currency, days: v.number() }),
    // Whether the amount is invoiced as soon as it is approved, or joins the project's billing schedule.
    billing: v.union(v.literal('invoice_now'), v.literal('with_the_schedule')),
    status: v.union(
      v.literal('draft'),
      v.literal('sent'),
      v.literal('approved'),
      v.literal('declined'),
      v.literal('withdrawn'),
    ),
    // Settled when it is sent, so the rule cannot move under a change request the client is already looking at.
    needsSignature: v.optional(v.boolean()),
    documentId: v.optional(v.id('documents')),
    decidedByContactId: v.optional(v.id('contacts')),
    decidedByMemberId: v.optional(v.id('teamMembers')),
    decidedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
    // Set by the approval, and what makes it happen only once.
    appliedAt: v.optional(v.number()),
    invoiceId: v.optional(v.id('invoices')),
    scheduleItemId: v.optional(v.string()),
    createdByMemberId: v.id('teamMembers'),
  })
    .index('by_project_status', ['projectId', 'status'])
    .index('by_document', ['documentId']),

  deliverables: defineTable({
    projectId: v.id('projects'),
    milestoneId: v.optional(v.id('milestones')),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal('draft'), v.literal('in_review'), v.literal('changes_requested'), v.literal('approved')),
    // 0 until the first version is submitted
    currentVersion: v.number(),
    approvedAt: v.optional(v.number()),
    approvedByContactId: v.optional(v.id('contacts')),
    approvedVersion: v.optional(v.number()),
    // What the client last asked to be changed, on the record rather than only in a notification, so the studio reads
    // it on the deliverable they are about to work on. Cleared when the next version goes out.
    changesAsked: v.optional(
      v.object({ note: v.string(), byContactId: v.id('contacts'), at: v.number(), version: v.number() }),
    ),
  })
    .index('by_project', ['projectId'])
    .index('by_milestone', ['milestoneId']),

  deliverableVersions: defineTable({
    deliverableId: v.id('deliverables'),
    projectId: v.id('projects'),
    version: v.number(),
    fileIds: v.array(v.id('files')),
    links: v.array(v.object({ label: v.optional(v.string()), url: v.string() })),
    notes: v.optional(v.string()),
    submittedByMemberId: v.id('teamMembers'),
    submittedAt: v.number(),
  }).index('by_deliverable_version', ['deliverableId', 'version']),

  timeEntries: defineTable({
    memberId: v.id('teamMembers'),
    projectId: v.id('projects'),
    taskId: v.optional(v.id('tasks')),
    ticketId: v.optional(v.id('tickets')),
    // YYYY-MM-DD in the studio's timezone, and the Monday of its week
    date: v.string(),
    weekStart: v.string(),
    minutes: v.number(),
    description: v.string(),
    billable: v.boolean(),
    status: v.union(v.literal('draft'), v.literal('submitted'), v.literal('approved'), v.literal('invoiced')),
    submittedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id('teamMembers')),
    approvedAt: v.optional(v.number()),
    // Why an approver sent the entry back
    returnedNote: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
    // The member's rates when the entry was logged. Absent when Finance had set none; sensitive.
    costRateMinor: v.optional(v.number()),
    billRateMinor: v.optional(v.number()),
    rateCurrency: v.optional(currency),
  })
    .index('by_member_date', ['memberId', 'date'])
    .index('by_member_week', ['memberId', 'weekStart', 'status'])
    .index('by_project_date', ['projectId', 'date'])
    .index('by_status', ['status'])
    .index('by_task', ['taskId']),

  // At most one running timer per member; stopping it writes a draft time entry.
  timers: defineTable({
    memberId: v.id('teamMembers'),
    projectId: v.id('projects'),
    taskId: v.optional(v.id('tasks')),
    description: v.string(),
    startedAt: v.number(),
  }).index('by_member', ['memberId']),

  comments: defineTable({
    target: v.object({ table: v.union(v.literal('deliverables'), v.literal('tasks')), id: v.string() }),
    projectId: v.optional(v.id('projects')),
    clientId: v.optional(v.id('clients')),
    body: v.string(),
    mentions: v.array(v.id('teamMembers')),
    // Internal comments never reach portal functions.
    visibility: v.union(v.literal('internal'), v.literal('client')),
    authorKind: v.union(v.literal('team'), v.literal('client')),
    authorId: v.string(),
    editedAt: v.optional(v.number()),
  }).index('by_target', ['target.table', 'target.id']),

  tasks: defineTable({
    projectId: v.id('projects'),
    milestoneId: v.optional(v.id('milestones')),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal('todo'), v.literal('in_progress'), v.literal('blocked'), v.literal('done')),
    priority: v.union(v.literal('low'), v.literal('medium'), v.literal('high'), v.literal('urgent')),
    assigneeMemberIds: v.array(v.id('teamMembers')),
    dueDate: v.optional(v.string()),
    estimateMinutes: v.optional(v.number()),
    order: v.number(),
    ticketId: v.optional(v.id('tickets')),
    changeRequestId: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  })
    .index('by_project_status', ['projectId', 'status', 'order'])
    .index('by_milestone', ['milestoneId']),

  taskAssignments: defineTable({
    taskId: v.id('tasks'),
    memberId: v.id('teamMembers'),
    status: v.union(v.literal('todo'), v.literal('in_progress'), v.literal('blocked'), v.literal('done')),
    dueDate: v.optional(v.string()),
  })
    .index('by_member_status', ['memberId', 'status'])
    .index('by_task', ['taskId']),

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
  // Documents and e-signatures (07-documents-and-esign.md). Templates and clauses are versioned, and a document keeps
  // the text it was created from, so editing either never changes a document that already exists.
  documentTemplates: defineTable({
    type: documentType,
    name: v.string(),
    description: v.optional(v.string()),
    version: v.number(),
    blocks: v.array(blockValidator),
    // Every variable the blocks use, kept for the template list and for validation on save.
    variables: v.array(v.string()),
    isDefault: v.boolean(),
    // Contract, NDA, DPA and team agreements stay flagged until the studio's lawyer approves the wording.
    requiresLegalReview: v.boolean(),
    // The lawyer's approval, recorded by the Owner against the exact version read. Editing makes a new version, which
    // needs approving again.
    legalApproval: v.optional(
      v.object({
        version: v.number(),
        approvedAt: v.number(),
        approvedByMemberId: v.id('teamMembers'),
        note: v.optional(v.string()),
      }),
    ),
    active: v.boolean(),
  })
    .index('by_type', ['type'])
    .index('by_name', ['name']),

  clauses: defineTable({
    key: v.string(),
    title: v.string(),
    body: v.string(),
    category: v.string(),
    version: v.number(),
    active: v.boolean(),
  })
    .index('by_key', ['key'])
    .index('by_category', ['category']),
  documents: defineTable({
    type: documentType,
    // Assigned on the first send and never reused, so a draft has none.
    number: v.optional(v.string()),
    title: v.string(),
    clientId: v.id('clients'),
    projectId: v.optional(v.id('projects')),
    dealId: v.optional(v.id('deals')),
    templateId: v.optional(v.id('documentTemplates')),
    templateVersion: v.optional(v.number()),
    status: v.union(
      v.literal('draft'),
      v.literal('sent'),
      v.literal('viewed'),
      v.literal('accepted'),
      v.literal('declined'),
      v.literal('expired'),
      v.literal('awaiting_signature'),
      v.literal('partially_signed'),
      v.literal('signed'),
      v.literal('void'),
    ),
    currency: v.optional(v.union(v.literal('NGN'), v.literal('USD'), v.literal('EUR'))),
    lineItems: v.optional(
      v.array(
        v.object({
          description: v.string(),
          quantityMilli: v.number(),
          unitPriceMinor: v.number(),
          amountMinor: v.number(),
          rateCardItemId: v.optional(v.id('rateCardItems')),
          taxable: v.boolean(),
        }),
      ),
    ),
    discount: v.optional(
      v.object({
        kind: v.union(v.literal('none'), v.literal('percent'), v.literal('fixed')),
        bps: v.optional(v.number()),
        amountMinor: v.optional(v.number()),
      }),
    ),
    vat: v.optional(v.object({ applies: v.boolean(), bps: v.number() })),
    wht: v.optional(v.object({ applies: v.boolean(), bps: v.number() })),
    totals: v.optional(
      v.object({
        subtotalMinor: v.number(),
        discountMinor: v.number(),
        taxableMinor: v.number(),
        vatMinor: v.number(),
        totalMinor: v.number(),
        whtExpectedMinor: v.number(),
      }),
    ),
    // The blocks as they read on this document: clause wording copied in, variables filled.
    blocks: v.array(blockValidator),
    currentVersion: v.number(),
    parentDocumentId: v.optional(v.id('documents')),
    // The first document in the chain, so quote → proposal → SOW → contract can be shown together.
    chainRootId: v.optional(v.id('documents')),
    validUntilDate: v.optional(v.string()),
    // The payment schedule in words, for {{schedule.summary}}, written on the draft until billing schedules exist.
    paymentScheduleSummary: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    firstViewedAt: v.optional(v.number()),
    lastViewedAt: v.optional(v.number()),
    viewCount: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedByContactId: v.optional(v.id('contacts')),
    // Set when the studio records a decision the client gave outside the portal.
    decisionRecordedByMemberId: v.optional(v.id('teamMembers')),
    decisionNote: v.optional(v.string()),
    // The version the recorded acceptance or decline was for.
    decidedVersion: v.optional(v.number()),
    declinedAt: v.optional(v.number()),
    declinedReason: v.optional(v.string()),
    signedAt: v.optional(v.number()),
    // Who it was emailed to on the last send. A client member may act on a document the studio addressed to them
    // (03-auth-and-permissions.md, Client roles), which needs the contacts kept rather than only their addresses.
    recipientContactIds: v.optional(v.array(v.id('contacts'))),
    // A sent document edited since its last version went out: the client still has that version until the next send.
    unsentChanges: v.optional(v.boolean()),
    voidReason: v.optional(v.string()),
    pdfFileId: v.optional(v.id('files')),
    pdfSha256: v.optional(v.string()),
    createdByMemberId: v.id('teamMembers'),
  })
    .index('by_client', ['clientId'])
    .index('by_project', ['projectId'])
    .index('by_status', ['status'])
    .index('by_chainRoot', ['chainRootId'])
    .searchIndex('search_documents', { searchField: 'title', filterFields: ['clientId', 'type', 'status'] }),

  // Immutable: one row per send, so a client can always be shown the version they were sent.
  documentVersions: defineTable({
    documentId: v.id('documents'),
    version: v.number(),
    blocks: v.array(blockValidator),
    lineItems: v.optional(v.array(v.any())),
    totals: v.optional(v.any()),
    pdfFileId: v.optional(v.id('files')),
    pdfSha256: v.optional(v.string()),
    // What the PDF was drawn from, as JSON, so the signed copy can be drawn again with the signatures in place. Kept
    // only alongside the PDF it produced.
    pdfPayload: v.optional(v.string()),
    // The editable source this version was sent from (the wording with its variables, title, dates and prices), so
    // unsent changes on the document can be discarded back to exactly what went out.
    source: v.optional(
      v.object({
        title: v.string(),
        blocks: v.array(blockValidator),
        lineItems: v.optional(v.array(v.any())),
        discount: v.optional(v.any()),
        vat: v.optional(v.any()),
        wht: v.optional(v.any()),
        totals: v.optional(v.any()),
        validUntilDate: v.optional(v.string()),
        paymentScheduleSummary: v.optional(v.string()),
        projectId: v.optional(v.id('projects')),
        dealId: v.optional(v.id('deals')),
      }),
    ),
    createdAt: v.number(),
    createdBy: v.id('teamMembers'),
    changeNote: v.optional(v.string()),
  }).index('by_document_version', ['documentId', 'version']),

  documentViews: defineTable({
    documentId: v.id('documents'),
    version: v.number(),
    viewerKind: v.union(v.literal('contact'), v.literal('token'), v.literal('member')),
    viewerId: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    viewedAt: v.number(),
  }).index('by_document', ['documentId', 'viewedAt']),
  // E-signatures (07-documents-and-esign.md). A request locks one version of a document and the hash of its PDF; each
  // signer holds their own link, whose token is stored only as a hash.
  signatureRequests: defineTable({
    documentId: v.id('documents'),
    documentVersion: v.number(),
    pdfSha256: v.string(),
    order: v.union(v.literal('sequential'), v.literal('parallel')),
    status: v.union(
      v.literal('pending'),
      v.literal('completed'),
      v.literal('declined'),
      v.literal('cancelled'),
      v.literal('expired'),
    ),
    expiresAt: v.number(),
    createdByMemberId: v.id('teamMembers'),
    signers: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        email: v.string(),
        kind: v.union(v.literal('client_contact'), v.literal('team_member')),
        contactId: v.optional(v.id('contacts')),
        memberId: v.optional(v.id('teamMembers')),
        order: v.number(),
        status: v.union(
          v.literal('waiting'),
          v.literal('invited'),
          v.literal('signed'),
          v.literal('declined'),
          v.literal('locked'),
        ),
        // SHA-256 of the link's token; the token itself exists only in the email.
        tokenHash: v.optional(v.string()),
        invitedAt: v.optional(v.number()),
        // The current emailed code, as a hash, with when it stops working and how many wrong tries it has had.
        codeHash: v.optional(v.string()),
        codeExpiresAt: v.optional(v.number()),
        codeAttempts: v.optional(v.number()),
        otpVerifiedAt: v.optional(v.number()),
        viewedAt: v.optional(v.number()),
        signedAt: v.optional(v.number()),
        declinedAt: v.optional(v.number()),
        declineReason: v.optional(v.string()),
        remindersSent: v.optional(v.array(v.string())),
      }),
    ),
    completedAt: v.optional(v.number()),
    // The locked PDF with the certificate page added, and its own hash. Set by the completion action.
    finalPdfFileId: v.optional(v.id('files')),
    finalPdfSha256: v.optional(v.string()),
    // Why the completion action last failed, until it succeeds.
    completionError: v.optional(v.string()),
    // The latest tamper check: the stored PDFs' hashes recomputed and compared with the recorded ones.
    lastVerification: v.optional(v.object({ checkedAt: v.number(), ok: v.boolean(), byMemberId: v.id('teamMembers') })),
  })
    .index('by_document', ['documentId'])
    .index('by_status', ['status']),

  // Finds a signer from their link without scanning every request: signers live in an array, which cannot be indexed.
  signingLinks: defineTable({
    tokenHash: v.string(),
    signatureRequestId: v.id('signatureRequests'),
    signerId: v.string(),
  })
    .index('by_token', ['tokenHash'])
    .index('by_request_signer', ['signatureRequestId', 'signerId']),

  // Immutable evidence of one signature.
  signatures: defineTable({
    signatureRequestId: v.id('signatureRequests'),
    signerId: v.string(),
    method: v.union(v.literal('typed'), v.literal('drawn')),
    typedName: v.optional(v.string()),
    imageFileId: v.optional(v.id('files')),
    consentText: v.string(),
    consentVersion: v.number(),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    // For a client, when their emailed code was checked; for the studio, when their two-factor sign-in was.
    otpVerifiedAt: v.number(),
    verification: v.union(v.literal('email_code'), v.literal('app_session')),
    signedAt: v.number(),
    documentSha256: v.string(),
  }).index('by_request', ['signatureRequestId']),

  // Billing (08-billing-and-finance.md). Every amount is integer minor units in the invoice's currency; totals come only
  // from convex/lib/money.ts. A sent invoice is immutable: corrections are credit notes, or a void while nothing is paid.
  invoices: defineTable({
    number: v.optional(v.string()),
    clientId: v.id('clients'),
    projectId: v.optional(v.id('projects')),
    contractDocumentId: v.optional(v.id('documents')),
    type: v.union(
      v.literal('standard'),
      v.literal('deposit'),
      v.literal('milestone'),
      v.literal('retainer'),
      v.literal('time_and_materials'),
      v.literal('renewal'),
      v.literal('late_fee'),
      v.literal('change_request'),
    ),
    status: v.union(
      v.literal('draft'),
      v.literal('scheduled'),
      v.literal('sent'),
      v.literal('viewed'),
      v.literal('partially_paid'),
      v.literal('paid'),
      v.literal('overdue'),
      v.literal('void'),
      v.literal('written_off'),
    ),
    // Set when it is sent: the studio's date that day, and that date plus the payment terms.
    issueDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    paymentTermsDays: v.number(),
    currency,
    // NGN per one unit of the currency, × 1,000,000. Taken from the latest rate until sent, then frozen.
    fxRateToNgnMicro: v.number(),
    // A rate typed on this invoice rather than taken from the rates table; kept at send instead of refreshed.
    fxRateOverridden: v.optional(v.boolean()),
    lineItems: v.array(
      v.object({
        description: v.string(),
        quantityMilli: v.number(),
        unitPriceMinor: v.number(),
        amountMinor: v.number(),
        rateCardItemId: v.optional(v.id('rateCardItems')),
        timeEntryIds: v.optional(v.array(v.id('timeEntries'))),
        taxable: v.boolean(),
      }),
    ),
    discount: v.object({
      kind: v.union(v.literal('none'), v.literal('percent'), v.literal('fixed')),
      bps: v.optional(v.number()),
      amountMinor: v.optional(v.number()),
    }),
    vat: v.object({ applies: v.boolean(), bps: v.number() }),
    wht: v.object({ applies: v.boolean(), bps: v.number() }),
    totals: v.object({
      subtotalMinor: v.number(),
      discountMinor: v.number(),
      taxableMinor: v.number(),
      vatMinor: v.number(),
      totalMinor: v.number(),
      whtExpectedMinor: v.number(),
    }),
    paidMinor: v.number(),
    whtCreditedMinor: v.number(),
    creditedMinor: v.number(),
    balanceMinor: v.number(),
    // Hash of the pay link's token, and the Paystack transaction: filled in with payments (step 8).
    payToken: v.optional(v.string()),
    paystack: v.optional(
      v.object({
        reference: v.optional(v.string()),
        accessCode: v.optional(v.string()),
        authorizationUrl: v.optional(v.string()),
        linkExpiresAt: v.optional(v.number()),
      }),
    ),
    reminders: v.array(v.object({ kind: v.string(), sentAt: v.number() })),
    noReminders: v.optional(v.boolean()),
    lateFeeParentInvoiceId: v.optional(v.id('invoices')),
    notes: v.optional(v.string()),
    terms: v.optional(v.string()),
    // Who it went to on the last send.
    recipientContactIds: v.optional(v.array(v.id('contacts'))),
    // Every send, in order: the first and each time it was sent again, so a resend to somebody else does not erase who
    // received it before. Invoices sent before this existed carry only recipientContactIds.
    sends: v.optional(
      v.array(v.object({ at: v.number(), contactIds: v.array(v.id('contacts')), memberId: v.id('teamMembers') })),
    ),
    pdfFileId: v.optional(v.id('files')),
    pdfSha256: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    firstViewedAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
    voidedAt: v.optional(v.number()),
    writtenOffAt: v.optional(v.number()),
    // The balance written off as bad debt, and why; restored if the write-off is reversed.
    writtenOffMinor: v.optional(v.number()),
    writeOffReason: v.optional(v.string()),
    createdByMemberId: v.id('teamMembers'),
  })
    .index('by_client_status', ['clientId', 'status'])
    .index('by_status_due', ['status', 'dueDate'])
    .index('by_project', ['projectId'])
    .index('by_pay_token', ['payToken'])
    .index('by_late_fee_parent', ['lateFeeParentInvoiceId'])
    .searchIndex('search_number', { searchField: 'number' }),

  // Money received against an invoice. Manual for now; Paystack payments arrive with step 8.
  payments: defineTable({
    invoiceId: v.id('invoices'),
    clientId: v.id('clients'),
    amountMinor: v.number(),
    currency,
    method: v.union(v.literal('paystack'), v.literal('bank_transfer'), v.literal('cash'), v.literal('other')),
    status: v.union(
      v.literal('pending'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('refunded'),
      v.literal('partially_refunded'),
    ),
    // The studio's date the money arrived.
    receivedOn: v.string(),
    reference: v.optional(v.string()),
    paystackTransactionId: v.optional(v.string()),
    // How the client actually paid through Paystack (card, bank_transfer, ussd…) and the instrument in words, e.g.
    // "Visa ending 4081" or "GTBank transfer", from the verified transaction.
    paystackChannel: v.optional(v.string()),
    paystackInstrument: v.optional(v.string()),
    feesMinor: v.optional(v.number()),
    refundedMinor: v.number(),
    proofFileId: v.optional(v.id('files')),
    recordedByMemberId: v.optional(v.id('teamMembers')),
    receiptId: v.optional(v.id('receipts')),
    notes: v.optional(v.string()),
  })
    .index('by_invoice', ['invoiceId'])
    .index('by_reference', ['reference'])
    .index('by_client', ['clientId']),

  // Tax a client withheld from a payment and pays to the tax authority on the studio's behalf. It settles the invoice
  // like money; the certificate proving it is chased until it arrives.
  whtCredits: defineTable({
    invoiceId: v.id('invoices'),
    clientId: v.id('clients'),
    paymentId: v.optional(v.id('payments')),
    amountMinor: v.number(),
    currency,
    status: v.union(
      v.literal('expected'),
      v.literal('certificate_received'),
      v.literal('disputed'),
      v.literal('reversed'),
    ),
    certificateFileId: v.optional(v.id('files')),
    certificateNumber: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    disputeNote: v.optional(v.string()),
    reversedReason: v.optional(v.string()),
    reversedAt: v.optional(v.number()),
  })
    .index('by_status', ['status'])
    .index('by_invoice', ['invoiceId'])
    .index('by_client', ['clientId']),

  receipts: defineTable({
    number: v.string(),
    paymentId: v.id('payments'),
    invoiceId: v.id('invoices'),
    clientId: v.id('clients'),
    pdfFileId: v.optional(v.id('files')),
    pdfSha256: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    // Unticked when the payment was recorded: the PDF is made, but nobody is emailed.
    emailed: v.boolean(),
  })
    .index('by_payment', ['paymentId'])
    .index('by_invoice', ['invoiceId']),

  // A correction to what an invoice charged. Its amount includes VAT in the invoice's own proportion (studio,
  // 2026-09-22). The part that fits the invoice's balance is applied to it; the rest is held as client credit.
  creditNotes: defineTable({
    number: v.string(),
    invoiceId: v.id('invoices'),
    clientId: v.id('clients'),
    currency,
    issueDate: v.string(),
    reason: v.string(),
    lineItems: v.array(
      v.object({
        description: v.string(),
        quantityMilli: v.number(),
        unitPriceMinor: v.number(),
        amountMinor: v.number(),
      }),
    ),
    netMinor: v.number(),
    vatMinor: v.number(),
    amountMinor: v.number(),
    appliedToInvoiceMinor: v.number(),
    heldMinor: v.number(),
    status: v.union(v.literal('issued'), v.literal('applied'), v.literal('refunded')),
    fxRateToNgnMicro: v.number(),
    pdfFileId: v.optional(v.id('files')),
    pdfSha256: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    createdByMemberId: v.id('teamMembers'),
  })
    .index('by_invoice', ['invoiceId'])
    .index('by_client', ['clientId']),

  // Credit held for a client, from a credit note bigger than what its invoice still owed. Applied to a later invoice in
  // the same currency by hand, or refunded (studio, 2026-09-22).
  clientCredits: defineTable({
    clientId: v.id('clients'),
    currency,
    creditNoteId: v.id('creditNotes'),
    amountMinor: v.number(),
    remainingMinor: v.number(),
  })
    .index('by_client', ['clientId'])
    .index('by_credit_note', ['creditNoteId']),

  // Where held credit went: each application to an invoice, kept for the statement and the audit trail.
  creditApplications: defineTable({
    clientCreditId: v.id('clientCredits'),
    invoiceId: v.id('invoices'),
    clientId: v.id('clients'),
    amountMinor: v.number(),
    appliedByMemberId: v.id('teamMembers'),
    appliedAt: v.number(),
  })
    .index('by_invoice', ['invoiceId'])
    .index('by_credit', ['clientCreditId']),

  // Money given back: against a payment (which reopens its invoice's balance) or from held credit (which does not).
  refunds: defineTable({
    paymentId: v.optional(v.id('payments')),
    clientCreditId: v.optional(v.id('clientCredits')),
    clientId: v.id('clients'),
    amountMinor: v.number(),
    currency,
    reason: v.string(),
    method: v.union(v.literal('paystack'), v.literal('bank_transfer'), v.literal('cash'), v.literal('other')),
    reference: v.optional(v.string()),
    paystackRefundId: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('processed'), v.literal('failed')),
    processedAt: v.optional(v.number()),
    recordedByMemberId: v.id('teamMembers'),
  })
    .index('by_payment', ['paymentId'])
    .index('by_client', ['clientId']),

  // Every webhook a provider sends, kept so the same event is never processed twice (14-platform.md, Webhooks).
  webhookEvents: defineTable({
    provider: v.union(v.literal('paystack'), v.literal('resend'), v.literal('whatsapp')),
    eventId: v.string(),
    type: v.string(),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    status: v.union(v.literal('received'), v.literal('processed'), v.literal('failed'), v.literal('ignored')),
    error: v.optional(v.string()),
    attempts: v.number(),
    payload: v.string(),
  }).index('by_provider_event', ['provider', 'eventId']),

  // Statement PDFs asked for by the team, for a client and a date range. Rendered by an action and kept, so the same
  // statement can be downloaded again.
  statements: defineTable({
    clientId: v.id('clients'),
    fromDate: v.string(),
    toDate: v.string(),
    status: v.union(v.literal('rendering'), v.literal('ready'), v.literal('failed')),
    fileId: v.optional(v.id('files')),
    requestedByMemberId: v.id('teamMembers'),
    failure: v.optional(v.string()),
  }).index('by_client', ['clientId']),

  // How a fixed-price project is invoiced in stages (08-billing-and-finance.md, Billing schedules). The items must add
  // up to the project's amount before the schedule can be activated; each raises an invoice when its trigger fires.
  billingSchedules: defineTable({
    projectId: v.id('projects'),
    clientId: v.id('clients'),
    contractDocumentId: v.optional(v.id('documents')),
    currency,
    status: v.union(v.literal('draft'), v.literal('active'), v.literal('ended')),
    amountMinor: v.number(),
    items: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        kind: v.union(v.literal('percent'), v.literal('fixed')),
        bps: v.optional(v.number()),
        amountMinor: v.number(),
        trigger: v.union(v.literal('on_signature'), v.literal('on_date'), v.literal('on_milestone_approved')),
        date: v.optional(v.string()),
        milestoneId: v.optional(v.id('milestones')),
        invoiceId: v.optional(v.id('invoices')),
        status: v.union(v.literal('pending'), v.literal('invoiced'), v.literal('skipped')),
        invoicedAt: v.optional(v.number()),
      }),
    ),
    // Invoices raised by the schedule go out on their own instead of waiting in the drafts queue.
    autoSend: v.boolean(),
    createdByMemberId: v.id('teamMembers'),
  })
    .index('by_project', ['projectId'])
    .index('by_status', ['status'])
    .index('by_contract', ['contractDocumentId']),

  // An ongoing monthly arrangement (08-billing-and-finance.md, Retainers): a fee for a number of included minutes,
  // billed a period in advance, with anything beyond the included minutes billed after the period at the overage rate.
  retainers: defineTable({
    clientId: v.id('clients'),
    projectId: v.id('projects'),
    slaPolicyId: v.optional(v.id('slaPolicies')),
    currency,
    monthlyFeeMinor: v.number(),
    includedMinutes: v.number(),
    overageRateMinor: v.number(),
    // 1–31; a day past the end of a short month falls on its last day.
    invoiceDayOfMonth: v.number(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('paused'), v.literal('ended')),
    autoSend: v.boolean(),
    // Unused minutes carry into the next period only, and expire after it (studio, 2026-09-23).
    rolloverUnusedMinutes: v.boolean(),
    createdByMemberId: v.id('teamMembers'),
  })
    .index('by_project', ['projectId'])
    .index('by_client', ['clientId'])
    .index('by_status', ['status']),

  retainerPeriods: defineTable({
    retainerId: v.id('retainers'),
    // YYYY-MM-DD, inclusive of both ends.
    periodStart: v.string(),
    periodEnd: v.string(),
    // The retainer's own minutes for this period; rollover is counted on top and used first.
    includedMinutes: v.number(),
    rolloverMinutes: v.number(),
    usedMinutes: v.number(),
    invoiceId: v.optional(v.id('invoices')),
    overageInvoiceId: v.optional(v.id('invoices')),
    alert80SentAt: v.optional(v.number()),
    alert100SentAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
  })
    .index('by_retainer_start', ['retainerId', 'periodStart'])
    .index('by_open', ['retainerId', 'closedAt']),

  // What the studio spent on a client's behalf or its own (08-billing-and-finance.md, Expenses). A billable one that
  // has been approved joins an invoice at cost, unless the studio sets a markup.
  expenses: defineTable({
    projectId: v.optional(v.id('projects')),
    clientId: v.optional(v.id('clients')),
    category: v.string(),
    description: v.string(),
    amountMinor: v.number(),
    currency,
    // The rate on the day it was spent, so reports in NGN do not move when today's rate does.
    fxRateToNgnMicro: v.number(),
    date: v.string(),
    receiptFileId: v.optional(v.id('files')),
    billable: v.boolean(),
    // Whether the studio owes the member their money back, and when it was paid.
    reimbursable: v.boolean(),
    reimbursedAt: v.optional(v.number()),
    status: v.union(
      v.literal('logged'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('reimbursed'),
      v.literal('invoiced'),
    ),
    decisionNote: v.optional(v.string()),
    loggedByMemberId: v.id('teamMembers'),
    approvedBy: v.optional(v.id('teamMembers')),
    approvedAt: v.optional(v.number()),
    invoiceId: v.optional(v.id('invoices')),
  })
    .index('by_project', ['projectId'])
    .index('by_status', ['status'])
    .index('by_member_date', ['loggedByMemberId', 'date'])
    .index('by_invoice', ['invoiceId']),

  // Who the studio pays (08-billing-and-finance.md, Vendors and bills): contractors, who may also be team members, and
  // suppliers. Bank details are sensitive: redacted in the audit log and returned only to the people who pay.
  vendors: defineTable({
    name: v.string(),
    kind: v.union(v.literal('contractor'), v.literal('supplier')),
    memberId: v.optional(v.id('teamMembers')),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    bankDetails: v.optional(
      v.object({
        bankName: v.string(),
        accountName: v.string(),
        accountNumber: v.string(),
        swift: v.optional(v.string()),
        iban: v.optional(v.string()),
      }),
    ),
    tin: v.optional(v.string()),
    // What the studio must withhold when it pays them, and remit on their behalf.
    whtBps: v.optional(v.number()),
    notes: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('archived')),
    createdByMemberId: v.id('teamMembers'),
  })
    .index('by_status', ['status'])
    .index('by_member', ['memberId']),

  bills: defineTable({
    vendorId: v.id('vendors'),
    projectId: v.optional(v.id('projects')),
    // The vendor's own invoice number, which is what both sides call it.
    reference: v.string(),
    description: v.string(),
    amountMinor: v.number(),
    // VAT the vendor charged, inside amountMinor. Withholding is worked out on the rest (studio, 2026-09-23).
    vatMinor: v.optional(v.number()),
    currency,
    fxRateToNgnMicro: v.number(),
    issueDate: v.string(),
    dueDate: v.string(),
    status: v.union(
      v.literal('draft'),
      v.literal('approved'),
      v.literal('scheduled'),
      v.literal('paid'),
      v.literal('void'),
    ),
    scheduledFor: v.optional(v.string()),
    fileId: v.optional(v.id('files')),
    // Filled when it is paid: what was withheld, what actually left the account, and how it was sent.
    whtMinor: v.optional(v.number()),
    paidMinor: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    paidOn: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
    paidByMemberId: v.optional(v.id('teamMembers')),
    voidReason: v.optional(v.string()),
    approvedByMemberId: v.optional(v.id('teamMembers')),
    createdByMemberId: v.id('teamMembers'),
  })
    .index('by_status_due', ['status', 'dueDate'])
    .index('by_vendor', ['vendorId'])
    .index('by_project', ['projectId'])
    .index('by_paid_on', ['paidOn']),

  // Manual rates (08-billing-and-finance.md, Foreign exchange): NGN per one unit, × 1,000,000, by day.
  fxRates: defineTable({
    currency: v.union(v.literal('USD'), v.literal('EUR')),
    date: v.string(),
    rateToNgnMicro: v.number(),
    source: v.literal('manual'),
    enteredByMemberId: v.id('teamMembers'),
  }).index('by_currency_date', ['currency', 'date']),

  // Support (09-support-and-sla.md). The SLA timers live on the ticket rather than being worked out on read: the
  // policy, its calendar and its holidays can all change afterwards, and a ticket is judged against what it was
  // promised when it was raised.
  tickets: defineTable({
    number: v.string(),
    clientId: v.id('clients'),
    projectId: v.optional(v.id('projects')),
    // The policy that applied when the ticket was raised: the project's, else the client's, else none.
    slaPolicyId: v.optional(v.id('slaPolicies')),
    priority: v.union(v.literal('p1'), v.literal('p2'), v.literal('p3'), v.literal('p4')),
    status: v.union(
      v.literal('new'),
      v.literal('open'),
      v.literal('pending_client'),
      v.literal('resolved'),
      v.literal('closed'),
    ),
    subject: v.string(),
    channel: v.union(v.literal('portal'), v.literal('team'), v.literal('email'), v.literal('monitor')),
    requesterContactId: v.optional(v.id('contacts')),
    raisedByMemberId: v.optional(v.id('teamMembers')),
    assigneeMemberId: v.optional(v.id('teamMembers')),
    createdAt: v.number(),
    firstResponseDueAt: v.optional(v.number()),
    // Absent when the policy calls this priority best effort.
    resolutionDueAt: v.optional(v.number()),
    // 75% of each target, stored beside the due time so the warning moves with it rather than being worked out from a
    // policy that may since have changed.
    firstResponseWarnAt: v.optional(v.number()),
    resolutionWarnAt: v.optional(v.number()),
    // When each alert went out. Set once, so a warning and a breach are each sent one time per ticket per target
    // however often the cron runs (09-support-and-sla.md, Breach warnings).
    warnedFirstResponseAt: v.optional(v.number()),
    breachedFirstResponseAt: v.optional(v.number()),
    warnedResolutionAt: v.optional(v.number()),
    breachedResolutionAt: v.optional(v.number()),
    firstRespondedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    // Set while the status is pending_client; the business minutes spent waiting are added to the resolution due time
    // on resume, so time the client takes is not counted against the studio.
    pausedAt: v.optional(v.number()),
    pausedMinutes: v.number(),
  })
    .index('by_number', ['number'])
    .index('by_client', ['clientId'])
    .index('by_project', ['projectId'])
    .index('by_assignee', ['assigneeMemberId'])
    .index('by_status', ['status']),

  ticketMessages: defineTable({
    ticketId: v.id('tickets'),
    // Internal notes are the studio's own and never leave it; see the portal rules in 12-client-portal.md.
    visibility: v.union(v.literal('public'), v.literal('internal')),
    body: v.string(),
    authorKind: v.union(v.literal('team'), v.literal('client'), v.literal('system')),
    authorMemberId: v.optional(v.id('teamMembers')),
    authorContactId: v.optional(v.id('contacts')),
    fileIds: v.array(v.id('files')),
    createdAt: v.number(),
  }).index('by_ticket', ['ticketId']),
});
