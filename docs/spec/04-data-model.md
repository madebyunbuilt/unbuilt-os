# 04 — Data model

Convex tables, grouped by module. Field lists are the contract; add fields when a module needs them, but do not
rename or repurpose these without updating this file. Every table also has Convex's `_id` and `_creationTime`.

Better Auth's own tables (users, sessions, accounts, verification) are owned by the component and not listed here.

## Shared rules

### Money

- Store amounts as integers in **minor units** (kobo, cents) in fields named `...Minor`, always next to a `currency`
  field (`'NGN' | 'USD' | 'EUR'`, extensible).
- Never store or compute money with floats. Percentages are stored as **basis points** (`vatBps: 750` is 7.5%).
- Rounding: calculate each line in minor units, round half up at each step in the order below, and never re-derive
  totals from rounded display values.
  1. line amount = quantity × unit price (quantity stored as thousandths: `quantityMilli`)
  2. subtotal = sum of lines
  3. discount (percentage of subtotal, or fixed amount capped at subtotal)
  4. net amount = subtotal − discount
  5. taxable amount (`totals.taxableMinor`) = taxable lines − their share of the discount, where the share is
     discount × taxable lines ÷ subtotal
  6. VAT = taxable amount × VAT rate
  7. total = net amount + VAT
  8. expected WHT = net amount × WHT rate (WHT is on the amount before VAT, including non-taxable lines)
- Only lines with `taxable = true` carry VAT. When every line is taxable, the taxable amount equals the net amount.
- Quantities, unit prices, discounts and rates are never negative. Reductions use the discount or a credit note.
- One implementation in `convex/lib/money.ts`, used by invoices, quotes, credit notes, the portal and the PDFs.

### Foreign exchange

- Any record with money in a non-NGN currency stores `fxRateToNgnMicro`: NGN per one unit of the currency, times 1,000,000,
  captured when the record is issued. Reports convert with the stored rate, never today's rate.

### Numbering

- Human-readable numbers come from `counters`, incremented inside the same mutation that creates the record, so Convex's
  transactions guarantee no duplicates or gaps.
- Default formats (configurable in settings, zero-padded to 4 digits, never reset):

| Record         | Format         |
| -------------- | -------------- |
| Invoice        | `UNB-INV-0001` |
| Quote          | `UNB-QUO-0001` |
| Proposal       | `UNB-PRO-0001` |
| SOW            | `UNB-SOW-0001` |
| Contract       | `UNB-CON-0001` |
| SLA            | `UNB-SLA-0001` |
| Change request | `UNB-CR-0001`  |
| NDA            | `UNB-NDA-0001` |
| DPA            | `UNB-DPA-0001` |
| Handover       | `UNB-HOV-0001` |
| Team agreement | `UNB-TA-0001`  |
| Other document | `UNB-DOC-0001` |
| Credit note    | `UNB-CN-0001`  |
| Receipt        | `UNB-RCT-0001` |
| Ticket         | `UNB-TKT-0001` |
| Project code   | `UNB-P-0001`   |

- Drafts get a number only when first sent or issued, so abandoned drafts never burn numbers.

### Time

- Timestamps: UTC epoch milliseconds (`...At`). Calendar dates without time: `YYYY-MM-DD` strings (`...Date`).
- Durations: minutes as integers.

### Soft delete and archiving

- Business records are never hard-deleted once sent, issued, signed or paid. Use `status` (void, archived) instead.
- Drafts may be deleted.
- Privacy deletions follow `15-security-and-compliance.md`.

## Organisation and settings

**orgSettings** (single row)
`legalName` `tradingName` `addressLines[]` `country` `tin` `vatNumber` `email` `phone` `website` `defaultCurrency`
`timezone` `logoFileId`
`bankAccounts[] { label, currency, bankName, accountName, accountNumber, swift?, iban?, sortCode? }` (sensitive)
`numbering { [recordType]: { prefix, padding } }` `defaultPaymentTermsDays` `defaultVatBps` `lateFeePolicy { enabled,
monthlyBps, graceDays }` `invoiceFooter` `quoteValidityDays` `retentionYears` `brand { primary, accent }`

The seed creates the row with `country` NG, `defaultCurrency` NGN, `timezone` Africa/Lagos, `defaultVatBps` 750, late
fees disabled at 500 bps, `retentionYears` 7, and no bank accounts. `legalName`, `tradingName`, `tin`, `vatNumber`,
`email`, `phone`, `website`,
`logoFileId`, `defaultPaymentTermsDays`, `invoiceFooter`, `quoteValidityDays` and `lateFeePolicy.graceDays` stay empty
until the studio sets them. `numbering` holds only overrides of the defaults below.

**counters** — `key` (e.g. `invoice`), `value`. Index: `by_key`.

**businessHours** — `name` `timezone` `weekly[] { day 0-6, start "09:00", end "17:00" }` `isDefault`. Index: `by_default`.

**holidays** — `date` `name` `country` `recurring` (matches the month and day every year), `source` (seed or manual)
`needsConfirmation` (movable holidays seeded as estimates). Index: `by_date`. The seed writes dated rows for each year
with `recurring = false`. Names are unique within a year.

**fxRates** — `currency` `date` `rateToNgnMicro` `source` (manual). Index: `by_currency_date`.

## People

**teamMembers**
`authUserId` `name` `email` `phone` `whatsapp` `title` `employmentType` (employee, contractor) `roleId` `status`
(invited, active, suspended, offboarded) `startDate` `endDate` `costRateMinor` `billRateMinor` `rateCurrency`
(cost and bill rates are sensitive) `capacityMinutesPerWeek` `timezone` `skills[]` `avatarFileId`
`googleCalendarConnected` `twoFactorEnabled` `invitedByMemberId?` `inviteExpiresAt?` `inviteLastSentAt?` `acceptedAt?`
`offboardedAt?`. Two-factor status is read from the Better Auth user rather than stored here.
Indexes: `by_authUser`, `by_email`, `by_status`, `by_role`. Emails are stored lowercase.

**roles** — `key` `name` `kind` (team, client) `permissions[]` `isSystem` `description`. Indexes: `by_kind`, `by_key`.

**timeOff** — `memberId` `type` (annual, sick, public, unpaid, other) `startDate` `endDate` `halfDay` `status`
(requested, approved, declined, cancelled) `note` `requestedBy` (the member, or an approver recording it) `decidedBy`
`decidedAt` `decisionNote` `cancelledBy` `cancelledAt`. Dates are YYYY-MM-DD in the studio's timezone. Indexes:
`by_member_start`, `by_status_end`.

**teamAgreements** — `memberId` `documentId` (NDA, contractor agreement, employment contract) `type` `signedAt`.

## CRM

**enquiries**
`source` (website, manual, email, referral) `name` `email` `company` `services[]` `stage` `budget` `timeline` `about`
`status` (new, reviewed, converted, spam, closed) `clientId?` `dealId?` `ip` `userAgent` `turnstilePassed`
`receivedAt` `createdBy?` (manual entries) `decidedBy?` `decidedAt?`. `stage`, `budget` and `timeline` are the website
form's option ids; labels live in `convex/lib/enquiries.ts`. Emails are stored lowercase.
Indexes: `by_status_received`, `by_email`.

**publicRateLimits** — `key` `windowStart` `count`. Fixed-window counters for public endpoints, cleared daily.
Indexes: `by_key`, `by_windowStart`.

**clients**
`displayName` `legalName` `kind` (company, individual) `status` (lead, active, past, archived) `industry` `website`
`country` `addressLines[]` `tin` `vatTreatment` (standard, zero_rated, exempt) `whtApplies` `whtBps`
`defaultCurrency` `paymentTermsDays` `timezone` `ownerMemberId` `source` `tags[]` `notes`
`slaPolicyId?` `portalEnabled`. Fields added with the CRM are optional so earlier rows stay valid; absent means empty,
standard VAT and no WHT.
Indexes: `by_status`, `by_owner`. Search index on `displayName`.

**contacts**
`clientId` `name` `email` `phone` `whatsapp` `whatsappOptIn { at, method, recordedBy? }?` `jobTitle` `isPrimary`
`isBilling` `portalAccess` `portalRoleId?` `portalInvitedAt?` `portalInviteLastSentAt?` `authUserId?` `status` (active,
left) `leftAt?`.
Indexes: `by_client`, `by_email`, `by_authUser`, `by_portalRole`. Search indexes on `name` and `email`. Emails are stored
lowercase.

**pipelineStages** — `name` `order` `probabilityBps` `kind` (open, won, lost). Exactly one won and one lost stage,
ordered after the open stages. Index: `by_order`.

**lostReasons** — `label` `order` `active`. Index: `by_order`.

**deals**
`title` `clientId` `primaryContactId?` `stageId` `valueMinor` `currency` `probabilityBps` `expectedCloseDate`
`ownerMemberId` `services[]` `source` `enquiryId?` `lostReasonId?` `lostNote?` `wonAt?` `lostAt?`
`nextFollowUpDate?` (YYYY-MM-DD in the studio's timezone) `lastActivityAt` `idleNotifiedAt?` `followUpNotifiedFor?`.
Indexes: `by_stage`, `by_client`, `by_owner_followup`, `by_enquiry`.

**activities** (timeline entries)
`subject { table, id }` (client, contact, deal, project, ticket) `clientId?` `type` (note, call, meeting, email_sent,
email_received, whatsapp_sent, status_change, document_event, payment_event, system) `title` `body?` `actorKind`
`actorId?` `occurredAt` `mentions[]?` (team members) `editedAt?` `meta`.
Indexes: `by_subject_occurred`, `by_client_occurred`.

**meetings** — `title` `startAt` `endAt` `attendeeContactIds[]` `attendeeMemberIds[]` `dealId?` `clientId?`
`projectId?` `googleEventId?` `location` `notes`.

**rateCardItems**
`name` `description` `serviceSlug?` `unit` (fixed, hour, day, week, month) `prices[] { currency, unitPriceMinor }`
`taxable` `active` `category`. Indexes: `by_active_name`, `by_name`.

**intakeForms** — `name` `fields[] { key, label, type, required, options? }` `projectTemplateId?`.
**intakeResponses** — `formId` `clientId` `projectId?` `answers` `submittedByContactId` `submittedAt`.

## Projects

**projects**
`code` `name` `clientId` `dealId?` `templateId?` `type` (mobile_app, web_platform, product_design, backend, devops,
video, dev_tool, retainer, other) `status` (planning, active, on_hold, completed, cancelled, archived) `billingModel`
(fixed, time_and_materials, retainer) `budgetMinor?` `currency` `startDate` `dueDate` `completedAt?` `managerMemberId`
`contractDocumentId?` `slaPolicyId?` `links { repo?, staging?, production?, design? }` `description`
`handoverStatus` (not_started, in_progress, complete).
Indexes: `by_client`, `by_status`, `by_manager`, `by_code`, `by_deal`. Search index on `name`.

**projectMembers** — `projectId` `memberId` `projectRole?` `joinedAt`. Indexes: `by_project`, `by_member`,
`by_project_member`.

**projectTemplates** — `name` `type` `milestones[] { name, offsetDays, billingPercentBps?, deliverables[] }`
`tasks[] { title, milestoneIndex?, estimateMinutes? }` `intakeFormId?` `checklists[] { kind, items[] }` `description?`
`active`. Index: `by_name`.

**milestones**
`projectId` `name` `order` `dueDate?` `status` (upcoming, in_progress, awaiting_approval, approved, invoiced, skipped)
`billingAmountMinor?` `billingPercentBps?` `approvedAt?` `approvedByContactId?`. Index: `by_project_order`.

**deliverables**
`projectId` `milestoneId?` `title` `description` `status` (draft, in_review, changes_requested, approved)
`currentVersion` (0 before the first submission) `approvedVersion?` `approvedAt?` `approvedByContactId?`.
Indexes: `by_project`, `by_milestone`.

**deliverableVersions** — `deliverableId` `projectId` `version` `fileIds[]` `links[] { label?, url }` `notes?`
`submittedByMemberId` `submittedAt`. Index: `by_deliverable_version`.

**comments**
`target { table, id }` `projectId?` `clientId?` `body` `mentions[]` `visibility` (internal, client) `authorKind`
`authorId` `editedAt?`. Index: `by_target`.

**tasks**
`projectId` `milestoneId?` `title` `description` `status` (todo, in_progress, blocked, done) `priority` (low, medium,
high, urgent) `assigneeMemberIds[]` `dueDate?` `estimateMinutes?` `order` `ticketId?` `changeRequestId?`
`completedAt?`. Indexes: `by_project_status` (with order), `by_milestone`.

**taskAssignments** — `taskId` `memberId` `status` `dueDate?`, mirroring each assignee of a task (Convex cannot index an
array). Indexes: `by_member_status`, `by_task`.

**timeEntries**
`memberId` `projectId` `taskId?` `ticketId?` `date` `weekStart` (the Monday of the entry's week) `minutes`
`description` `billable` `status` (draft, submitted, approved, invoiced) `submittedAt?` `approvedBy?` `approvedAt?`
`returnedNote?` `invoiceId?` `costRateMinor?` `billRateMinor?` `rateCurrency?` (rates snapshotted at entry time, absent
when the member had none; sensitive and redacted in audit diffs).
Indexes: `by_member_date`, `by_member_week` (with status), `by_project_date`, `by_status`, `by_task`.

**timers** — `memberId` `projectId` `taskId?` `description` `startedAt`. At most one per member; stopping it writes a
draft time entry. Index: `by_member`.

**changeRequests**
`number` `projectId` `title` `description` `reason` `impact { amountMinor, currency, days }` `status` (draft, sent,
approved, declined, withdrawn) `documentId?` `decidedByContactId?` `decidedAt?` `invoiceId?`.
Index: `by_project_status`.

**statusUpdates** — `projectId` `periodStart` `periodEnd` `summary` `done[]` `next[]` `risks[]` `status` (draft, sent)
`sentAt?`.

**checklists** — `kind` (onboarding, handover, offboarding_member, custom) `target { table, id }` `items[] { label,
key?, done, doneBy?, doneAt?, required }`. Items with a `key` are ticked by the system. Index: `by_target` (table, id,
kind).

## Documents and signatures

**documentTemplates**
`type` (quote, proposal, sow, contract, sla, nda, dpa, change_request, handover, team_agreement, other) `name`
`version` `blocks` (see `07-documents-and-esign.md`) `variables[]` `isDefault` `active`.

**clauses** — `key` `title` `body` `category` `version` `active`.

**documents**
`type` `number?` `title` `clientId` `projectId?` `dealId?` `templateId` `templateVersion` `status` (draft, sent,
viewed, accepted, declined, expired, awaiting_signature, partially_signed, signed, void) `currency?` `lineItems[]?`
`totals?` `blocks` (resolved snapshot) `currentVersion` `parentDocumentId?` `chainRootId` `validUntilDate?` `sentAt?`
`firstViewedAt?` `lastViewedAt?` `viewCount` `acceptedAt?` `declinedReason?` `signedAt?` `pdfFileId?` `pdfSha256?`
`createdByMemberId`.
Indexes: `by_client`, `by_project`, `by_status`, `by_chainRoot`. Search index on `title` and `number`.

**documentVersions** — `documentId` `version` `blocks` `lineItems` `totals` `pdfFileId` `pdfSha256` `createdAt`
`createdBy` `changeNote`. Versions are immutable.

**documentViews** — `documentId` `version` `viewerKind` (contact, token, member) `viewerId?` `ip` `userAgent`
`viewedAt`.

**signatureRequests**
`documentId` `documentVersion` `pdfSha256` `order` (sequential, parallel) `status` (pending, completed, declined,
cancelled, expired) `expiresAt` `signers[] { id, name, email, kind (client_contact, team_member), contactId?, memberId?,
order, status, tokenHash, otpVerifiedAt?, viewedAt?, signedAt?, declinedAt?, declineReason? }`.

**signatures**
`signatureRequestId` `signerId` `method` (typed, drawn) `typedName?` `imageFileId?` `consentText` `consentVersion`
`ip` `userAgent` `otpVerifiedAt` `signedAt` `documentSha256`. Immutable.

## Billing and finance

**invoices**
`number?` `clientId` `projectId?` `contractDocumentId?` `type` (standard, deposit, milestone, retainer, time_and_materials,
renewal, late_fee, change_request) `status` (draft, scheduled, sent, viewed, partially_paid, paid, overdue, void,
written_off) `issueDate?` `dueDate?` `currency` `fxRateToNgnMicro` `lineItems[] { description, quantityMilli,
unitPriceMinor, amountMinor, rateCardItemId?, timeEntryIds?[], taxable }` `discount { kind (none, percent, fixed),
bps?, amountMinor? }` `vat { applies, bps }` `wht { applies, bps }` `totals { subtotalMinor, discountMinor,
taxableMinor, vatMinor, totalMinor, whtExpectedMinor }` `paidMinor` `whtCreditedMinor` `creditedMinor`
`balanceMinor` `payToken` (hash) `paystack { reference?, accessCode?, authorizationUrl?, linkExpiresAt? }`
`reminders[] { kind, sentAt }` `lateFeeParentInvoiceId?` `notes` `terms` `pdfFileId?` `pdfSha256?` `sentAt?`
`firstViewedAt?` `paidAt?` `voidReason?` `writtenOffAt?`.
Indexes: `by_client_status`, `by_status_due`, `by_project`. Search index on `number`.

**payments**
`invoiceId` `clientId` `amountMinor` `currency` `method` (paystack, bank_transfer, cash, other) `status` (pending,
succeeded, failed, refunded, partially_refunded) `receivedAt` `reference` `paystackTransactionId?` `feesMinor?`
`proofFileId?` `recordedByMemberId?` `receiptId?` `notes`.
Indexes: `by_invoice`, `by_reference`.

**whtCredits**
`invoiceId` `clientId` `amountMinor` `currency` `status` (expected, certificate_received, disputed) `certificateFileId?`
`certificateNumber?` `receivedAt?`. Index: `by_status`.

**receipts** — `number` `paymentId` `invoiceId` `pdfFileId` `sentAt?`.

**creditNotes**
`number` `invoiceId` `clientId` `amountMinor` `currency` `reason` `lineItems[]` `status` (issued, applied, refunded)
`pdfFileId`.

**refunds** — `paymentId` `amountMinor` `reason` `method` `paystackRefundId?` `status` `processedAt?`.

**billingSchedules**
`projectId` `contractDocumentId?` `currency` `items[] { label, kind (percent, fixed), bps?, amountMinor?, trigger
(on_signature, on_date, on_milestone_approved), date?, milestoneId?, invoiceId?, status (pending, invoiced, skipped) }`
`autoSend`.

**retainers**
`clientId` `projectId` `slaPolicyId?` `currency` `monthlyFeeMinor` `includedMinutes` `overageRateMinor`
`invoiceDayOfMonth` `startDate` `endDate?` `status` (active, paused, ended) `autoSend` `rolloverUnusedMinutes`.

**retainerPeriods** — `retainerId` `periodStart` `periodEnd` `includedMinutes` `usedMinutes` `rolloverMinutes`
`invoiceId?` `overageInvoiceId?` `alerts80SentAt?` `alerts100SentAt?`.

**expenses**
`projectId?` `category` `description` `amountMinor` `currency` `fxRateToNgnMicro` `date` `receiptFileId?` `billable`
`status` (logged, approved, rejected, reimbursed, invoiced) `loggedByMemberId` `approvedBy?` `invoiceId?`.

**vendors** — `name` `kind` (contractor, supplier) `memberId?` `email` `bankDetails` (sensitive) `tin?` `whtBps?`
`notes`.

**bills**
`vendorId` `projectId?` `reference` `description` `amountMinor` `currency` `fxRateToNgnMicro` `issueDate` `dueDate`
`status` (draft, approved, scheduled, paid, void) `fileId?` `paidAt?` `paymentReference?`.

## Support and SLAs

**slaPolicies**
`name` `businessHoursId` `targets[] { priority (p1, p2, p3, p4), firstResponseMinutes, resolutionMinutes? }` (absent
resolution means best effort) `includedMinutesPerMonth?` `uptimeTargetBps?` `active`. Index: `by_name`.

**tickets**
`number` `clientId` `projectId?` `slaPolicyId?` `subject` `description` `priority` `status` (open, pending_client,
in_progress, resolved, closed) `channel` (portal, email, team, monitor) `requesterContactId?` `assigneeMemberId?`
`firstResponseDueAt?` `resolutionDueAt?` `firstRespondedAt?` `resolvedAt?` `pausedMinutes` `pausedAt?`
`breaches { firstResponse, resolution }` `incidentId?`.
Indexes: `by_client_status`, `by_assignee_status`, `by_status_resolutionDue`.

**ticketMessages** — `ticketId` `body` `authorKind` `authorId` `visibility` (public, internal) `fileIds[]`
`viaEmail`.

**monitors** — `clientId` `projectId?` `name` `url` `method` `expectedStatus` `intervalMinutes` `timeoutMs`
`status` (up, down, paused) `lastCheckedAt` `lastStatusCode` `consecutiveFailures`.

**monitorChecks** — `monitorId` `checkedAt` `ok` `statusCode?` `latencyMs?` `error?`. Retain 90 days.

**incidents** — `monitorId` `startedAt` `resolvedAt?` `ticketId?` `summary`.

**managedAssets**
`clientId` `projectId?` `type` (domain, hosting, ssl, app_store_account, subscription, other) `name` `provider`
`renewsOnDate` `costMinor` `costCurrency` `billPriceMinor` `billCurrency` `autoInvoice` `remindersSent[]`
`status` (active, cancelled, transferred).

## Vault

**vaultItems**
`clientId` `projectId?` `label` `kind` (login, api_key, ssh_key, env_file, note) `url?` `usernameCiphertext?`
`secretCiphertext` `notesCiphertext?` `iv` `keyVersion` `submittedByKind` `submittedById` `lastRevealedAt?`
`rotateByDate?`. Plaintext never stored.

**vaultAccessLogs** — `vaultItemId` `memberId` `action` (reveal, copy, update, delete) `at` `ip` `userAgent`.

## CMS

**works** — mirrors the website's `Project` type: `slug` `name` `art` (glossup, qravit, orrery, commit, pr, extensible)
`listLine` `listDetail` `seo { title, description }` `summary` `meta { client, year, role, status }` `stack[]`
`link? { href, label }` `brief[]` `hardPart[]` `built[]` `results[]?` `shots[] { fileId?, alt, caption, frame (phone,
desktop, wide) }` `order` `status` (draft, published) `projectId?` `publishedAt?`.

**servicePages** — `slug` `name` `short` `long` `stack[]` `deliverables[]` `seo { title, description }` `body`
(rich text blocks) `order` `status`.

**posts** — `slug` `title` `excerpt` `body` `coverFileId?` `authorMemberId` `tags[]` `seo { title, description }`
`status` (draft, scheduled, published) `publishAt?` `publishedAt?`.

**legalPages** — mirrors the website's `LegalDoc`: `slug` `title` `intro` `sheet` `updatedDate` `sections[] { heading,
body[], list?[] }` `status`.

**testimonials** — `quote` `authorName` `authorRole` `clientId?` `workId?` `approvedByClientAt?` `status`.

**siteSettings** (single row) — `name` `url` `email` `phone` `socials[] { name, handle, href }` `timeZone`
`statusText` (e.g. "Taking new work") `seoDefaults`.

**contentRevisions** — `target { table, id }` `snapshot` `editedBy` `editedAt`.

**publishes** — `requestedBy` `requestedAt` `deployHookCalledAt?` `status` `changes[]`.

## Platform

**notifications** — `recipientKind` (team, client) `recipientId` (team member or contact id) `event` `title` `body`
`link?` (in-app path) `readAt?` `channels { inApp, email?, whatsapp? }` `createdAt`. Indexes: `by_recipient_read`,
`by_recipient_created`.

**notificationPreferences** — `principalKind` `principalId` `event` `inApp` `email` `whatsapp`.

**messageLog** — `channel` (email, whatsapp) `to` `template` `subject?` `clientId?` `relatedTo { table, id }?`
`providerMessageId` `status` (queued, sent, delivered, opened, bounced, failed) `events[]` `sentAt`.

**files** — `storageId` `name` `mimeType` `sizeBytes` `sha256` (hex) `owner { table, id }` `clientId?` `projectId?`
`visibility` (internal, client) `uploadedByKind` (team, client, system) `uploadedById`. Indexes: `by_owner`,
`by_client`, `by_storage`.

**auditLog** — `actorKind` (team, client, system) `actorId?` `authUserId?` `permission?` `action` (insert, update,
delete, read) `table` `recordId` `diff { before?, after? }` (changed fields only, sensitive fields redacted) `ip?`
`userAgent?` `at`. See `03-auth-and-permissions.md`. Indexes: `by_target` (table, recordId, at), `by_actor_at`, `by_at`.

**webhookEvents** — `provider` (paystack, resend, whatsapp) `eventId` `type` `receivedAt` `processedAt?` `status`
`error?` `payload`. Unique index `by_provider_event` for idempotency.

**importJobs** — `kind` `fileId` `status` `mapping` `rowsTotal` `rowsImported` `errors[]` `startedBy`.

**privacyRequests** — `kind` (access, deletion, correction, restriction) `subjectEmail` `receivedAt` `dueDate`
`status` `handledBy` `exportFileId?` `notes`.

**integrations** — `provider` `memberId?` `status` `encryptedTokens` `scopes[]` `connectedAt`.
