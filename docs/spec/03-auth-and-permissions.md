# 03 — Auth, roles and permissions

## Identities

Better Auth runs inside Convex through `@convex-dev/better-auth`, so users, sessions and accounts live in the same
database as everything else.

Every authenticated person has exactly one **principal** of one kind:

- **Team member** — a row in `teamMembers`, holding one team role.
- **Client user** — a row in `contacts` with `portalAccess = true`, holding one client role, scoped to exactly one client.

A person who is both (for example a contractor who is also a client contact elsewhere) gets two separate accounts on
two email addresses. Never let one session act on both surfaces.

## Sign-in

| Surface | Method                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Team    | Email magic link, then TOTP two-factor. 2FA is mandatory; a team member without 2FA can only reach the 2FA setup screen. Passkeys optional |
| Portal  | Email magic link, then a 6-digit email code on new devices. No passwords                                                                   |
| Signing | Token link from the signature request email, then a 6-digit email code before signing (see `07-documents-and-esign.md`)                    |
| Paying  | Token link from the invoice email opens the invoice and Paystack checkout without an account                                               |

- Magic links expire in 15 minutes and work once. Links and codes are stored hashed.
- Better Auth applies its two-factor challenge only after password sign-in, so `convex/lib/authPlugins.ts` applies the
  same challenge after `/magic-link/verify`: the magic-link session is discarded and the two-factor verify endpoint
  creates the real one. A magic link alone never yields a session for an account with two-factor on.
- Team members enrol TOTP (with backup codes) on first sign-in and cannot disable or replace it themselves; an admin
  resets it. Team members cannot use emailed codes.
- Client users have two-factor on from account creation and only use emailed codes. "New device" means a device
  without a trusted-device cookie, which lasts 30 days after a successful code.
- Team sessions expire after 12 hours of inactivity; portal sessions after 7 days. Inactivity is measured from the last
  session refresh, which Better Auth records at most every 15 minutes while the app is open. Because every request
  refreshes the session, `expireIdleTeamSessions` checks idleness first and deletes an idle team session instead of
  refreshing it; the team function wrappers check it again.
- Team 2FA backup codes are shown once, at setup. The verify screen accepts an authenticator code or a backup code for
  team members, and an emailed code (with an opt-out "trust this device" checkbox) for client users.
- Invitations only. There is no public sign-up on either surface. Team members are invited by `team.manage`; client
  users by `contacts.manage` (team) or `portal.colleagues.manage` (client admin). An account can be created only for
  an email address that belongs to exactly one invited team member or one contact with portal access. Sign-in requests
  for any other address return the same response and send nothing.
- Offboarding a team member revokes all sessions immediately and removes project membership.
- All auth emails go through Resend with the templates in `emails/auth/`.

## Enforcement

`convex/lib/functions.ts` exposes the only function builders modules may use:

| Builder                                                 | Caller                            | Checks, in order                                                                                                       |
| ------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `teamQuery(permission)`                                 | Team                              | Session valid, principal is an active team member with 2FA, role has `permission`                                      |
| `teamMutation(permission)`                              | Team                              | As above, then writes an audit entry (see Audit)                                                                       |
| `teamAction(permission)`                                | Team                              | As above; actions call internal functions for data access                                                              |
| `portalQuery(permission)`                               | Client user                       | Session valid, principal is an active client user, role has `permission`, and every read is filtered to `ctx.clientId` |
| `portalMutation(permission)`                            | Client user                       | As above, plus audit                                                                                                   |
| `tokenQuery` / `tokenMutation`                          | Signing and pay links             | Token valid, unexpired, scoped to one document or invoice                                                              |
| `publicHttp`                                            | Website, webhooks                 | Rate limit, signature or Turnstile verification                                                                        |
| `internalQuery` / `internalMutation` / `internalAction` | Scheduler, crons, other functions | Not callable from clients                                                                                              |

The builders put `ctx.principal`, `ctx.permissions`, `ctx.clientId` (portal only) and `ctx.can(permission)` on the
context. Portal builders also add `ctx.ownedByClient(doc)`, which returns a document only when it belongs to
`ctx.clientId`.

Passing `null` as the permission (`teamQuery(null)`, `portalMutation(null)`) allows any active principal of that
surface. Use it only for the caller's own records that every principal has, such as their notifications; every other
check still applies.

`sessionQuery` accepts any signed-in session, with or without a principal or 2FA. It exists only for reading the
caller's own sign-in state (`auth.viewer`) and must never return business data. `tokenQuery` and `tokenMutation` are
added with the first module that needs them (documents, billing). `publicHttp` wraps an HTTP action: the handler
verifies its own signature, token or Turnstile response first; the wrapper adds `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer` and returns a bare 500 for unexpected errors, logging only the error name. Rate limiting
joins it with the first public form (CRM enquiries).

Every refusal uses a `ConvexError` code: `auth.unauthenticated`, `auth.sessionExpired`, `auth.twoFactorRequired` or
`auth.forbidden`. A missing permission and a missing principal both return `auth.forbidden`.

### Record-level rules

Role permissions decide what kind of action is allowed. Record rules decide which records:

- **Project scope.** Permissions ending in `.assigned` apply only to projects where the member is in `projectMembers`.
  Anything linked to a project (tasks, time, deliverables, files, vault items, change requests, tickets) inherits the
  project's scope. `projects.view.all` lifts the restriction.
- **Client scope.** Every portal read and write is filtered by `ctx.clientId`. Use a helper that takes the client id
  from context, never from arguments.
- **Own records.** `time.log.own` lets a member create and edit only their own unapproved time entries.
- **Sensitive fields.** Cost rates, salaries and bank details are stripped from query results unless the caller has
  the matching `.sensitive` permission. Do this in one serializer per table, not in each query.

## Permission keys

Keys follow `resource.action` or `resource.action.scope`. The full list lives in `convex/lib/permissions.ts` as a
typed constant; roles store arrays of these keys.

**CRM**
`enquiries.view` `enquiries.manage` `deals.view` `deals.manage` `clients.view` `clients.create` `clients.update`
`clients.delete` `clients.export` `contacts.manage` `ratecard.view` `ratecard.manage` `calendar.use` `intake.manage`

**Projects**
`projects.view.all` `projects.view.assigned` `projects.create` `projects.update` `projects.archive`
`projects.members.manage` `templates.projects.manage` `tasks.manage.assigned` `tasks.manage.all`
`deliverables.manage.assigned` `changerequests.create` `changerequests.send` `updates.send` `handover.manage`

**Time**
`time.log.own` `time.view.all` `time.approve` `time.edit.all`

**Documents**
`documents.view` `documents.view.assigned` `documents.create` `documents.update` `documents.send` `documents.void`
`documents.countersign` `templates.documents.manage`

**Billing and finance**
`invoices.view` `invoices.create` `invoices.update` `invoices.send` `invoices.void` `invoices.writeoff`
`invoices.latefees.waive` `payments.record` `payments.refund` `creditnotes.create` `schedules.manage`
`retainers.manage` `fx.manage` `expenses.log` `expenses.approve` `vendors.manage` `bills.manage` `bills.pay`
`finance.export` `reports.finance.view`

**Support**
`tickets.view.assigned` `tickets.view.all` `tickets.manage` `sla.manage` `monitors.manage` `assets.manage`

**Vault**
`vault.view.assigned` `vault.view.all` `vault.manage`

**Team**
`team.view` `team.manage` `team.rates.sensitive` `timeoff.request` `timeoff.approve` `capacity.view`
`reports.delivery.view`

**CMS**
`cms.view` `cms.edit` `cms.publish` `cms.settings.manage`

**Platform**
`settings.manage` `settings.billing.sensitive` `roles.manage` `audit.view` `imports.run` `privacy.requests.manage`
`integrations.manage` `owner.transfer`

**Portal (client roles only)**
`portal.projects.view` `portal.deliverables.approve` `portal.changerequests.approve` `portal.documents.view`
`portal.documents.sign` `portal.invoices.view` `portal.invoices.pay` `portal.tickets.create` `portal.tickets.view`
`portal.vault.submit` `portal.intake.submit` `portal.reports.view` `portal.colleagues.manage` `portal.files.upload`

A team role can never hold a `portal.*` key, and a client role can hold only `portal.*` keys. Enforce this when roles
are saved.

## Default roles

System roles are seeded, cannot be deleted, and only the Owner can edit them. `roles.manage` can create custom roles.

There is exactly one Owner at a time (decided by the studio on 2026-09-14). The Owner role cannot be given to a second
member; `owner.transfer` moves it, and the previous Owner becomes an Admin in the same mutation. Trusted partners are
Admins. To guard against losing the Owner account, the Owner keeps their backup codes safe and at least one Admin exists
who can reset the Owner's 2FA. The Team module enforces this.
A role that anyone still holds cannot be deleted, and a role cannot change kind. Saving a team role never grants a key
the caller does not hold, so `roles.manage` cannot be used to reach `owner.transfer`.

The exact keys per role are `DEFAULT_ROLES` in `convex/lib/permissions.ts`. Where the table below names no key, the
studio approved these on 2026-09-13:

- Every team role: `timeoff.request`.
- Finance: `fx.manage`, `schedules.manage`, `retainers.manage` (part of "Invoices: All"), `team.view`, `capacity.view`.
- Project manager: `invoices.view` (to create drafts), `handover.manage`, `templates.documents.manage`,
  `reports.delivery.view`, `calendar.use`, `time.log.own`, `clients.export` (part of "All except delete").
- Member: `documents.view.assigned`, a scoped key like the other `.assigned` keys, for "Documents: View assigned".
- Content editor: `cms.view`; not `cms.settings.manage`.

| Area                                        | Owner | Admin |     Finance      |   Project manager    |      Member      | Content editor |
| ------------------------------------------- | :---: | :---: | :--------------: | :------------------: | :--------------: | :------------: |
| Enquiries, deals, clients                   |  All  |  All  |       View       |  All except delete   |        —         |       —        |
| Contacts, rate card, intake                 |  All  |  All  |       View       |         All          |        —         |       —        |
| Projects                                    |  All  |  All  |     View all     |         All          |     Assigned     |       —        |
| Tasks, deliverables                         |  All  |  All  |        —         |         All          |     Assigned     |       —        |
| Time                                        |  All  |  All  |     View all     |    View, approve     |       Own        |       —        |
| Change requests, updates                    |  All  |  All  |       View       |     Create, send     |        —         |       —        |
| Documents and templates                     |  All  |  All  |       View       | Create, update, send |  View assigned   |       —        |
| Countersign documents                       |  Yes  |  Yes  |        —         |          —           |        —         |       —        |
| Invoices                                    |  All  |  All  |       All        |    Create drafts     |        —         |       —        |
| Payments, credit notes, refunds, write-offs |  All  |  All  |       All        |          —           |        —         |       —        |
| Expenses                                    |  All  |  All  |     Approve      |         Log          |       Log        |       —        |
| Vendors and bills                           |  All  |  All  |       All        |          —           |        —         |       —        |
| Finance reports and exports                 |  All  |  All  |       All        |          —           |        —         |       —        |
| Tickets, SLA, monitors, renewals            |  All  |  All  |       View       |         All          | Assigned tickets |       —        |
| Vault                                       |  All  |  All  |        —         |   Assigned, manage   |     Assigned     |       —        |
| Team, time off, capacity                    |  All  |  All  |       View       |    View, capacity    | Request time off |       —        |
| Cost rates (sensitive)                      |  Yes  |  Yes  |       Yes        |          —           |        —         |       —        |
| CMS                                         |  All  |  All  |        —         |         View         |        —         | Edit, publish  |
| Settings, roles, integrations               |  All  |  All  | Billing settings |          —           |        —         |       —        |
| Audit log, privacy requests                 |  All  |  All  |        —         |          —           |        —         |       —        |
| Transfer ownership                          |  Yes  |   —   |        —         |          —           |        —         |       —        |

**Client roles**

| Permission area                    | Client admin |        Client member        |
| ---------------------------------- | :----------: | :-------------------------: |
| View projects, milestones, updates |     Yes      |             Yes             |
| Approve deliverables               |     Yes      |             Yes             |
| Approve change requests            |     Yes      |              —              |
| View documents                     |     Yes      |             Yes             |
| Sign documents                     |     Yes      | Only when named as a signer |
| View and pay invoices              |     Yes      |              —              |
| Raise and view tickets             |     Yes      |             Yes             |
| Submit credentials to the vault    |     Yes      |             Yes             |
| Submit intake forms                |     Yes      |             Yes             |
| View SLA and retainer reports      |     Yes      |              —              |
| Invite and remove colleagues       |     Yes      |              —              |
| Upload files                       |     Yes      |             Yes             |

## Audit log

- `teamMutation` and `portalMutation` write an `auditLog` entry for every successful write: actor, principal kind,
  permission used, table, record id, a field-level diff (before and after, with sensitive fields redacted), IP and user
  agent when available, timestamp.
- Reads are audited only for sensitive data: vault reveals, credential exports, full data exports, and viewing another
  member's cost rate.
- The audit log is append-only. No mutation updates or deletes it. `audit.view` can search and export it.

## Acceptance criteria

- No exported Convex function in a module directory uses raw `query`, `mutation` or `action`; a test enforces it.
- A team member without 2FA cannot call any team function except those needed to set up 2FA.
- A client user calling any team function is rejected, and calling a portal function returns only their client's data,
  proven by tests with two clients.
- A Member sees only projects they are assigned to, and everything linked to other projects returns not found.
- Cost rates are absent from query results without `team.rates.sensitive`.
- Saving a team role with a `portal.*` key, or a client role with a team key, is rejected.
- System roles cannot be deleted; only the Owner can edit them.
- Every write produces exactly one audit entry; there is no code path that modifies or deletes audit entries.
- Removing a team member revokes their sessions within one request.
