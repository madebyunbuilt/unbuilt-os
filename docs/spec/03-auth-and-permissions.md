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

| Surface | Method                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------- |
| Team    | Email magic link, then TOTP two-factor. 2FA is mandatory; a team member without 2FA can only reach the 2FA setup screen. Passkeys optional |
| Portal  | Email magic link, then a 6-digit email code on new devices. No passwords                         |
| Signing | Token link from the signature request email, then a 6-digit email code before signing (see `07-documents-and-esign.md`) |
| Paying  | Token link from the invoice email opens the invoice and Paystack checkout without an account     |

- Magic links expire in 15 minutes and work once.
- Team sessions expire after 12 hours of inactivity; portal sessions after 7 days.
- Invitations only. There is no public sign-up on either surface. Team members are invited by `team.manage`; client
  users by `contacts.manage` (team) or `portal.colleagues.manage` (client admin).
- Offboarding a team member revokes all sessions immediately and removes project membership.
- All auth emails go through Resend with the templates in `emails/auth/`.

## Enforcement

`convex/lib/functions.ts` exposes the only function builders modules may use:

| Builder                          | Caller                   | Checks, in order                                                                 |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `teamQuery(permission)`          | Team                     | Session valid, principal is an active team member with 2FA, role has `permission` |
| `teamMutation(permission)`       | Team                     | As above, then writes an audit entry (see Audit)                                  |
| `teamAction(permission)`         | Team                     | As above; actions call internal functions for data access                        |
| `portalQuery(permission)`        | Client user              | Session valid, principal is an active client user, role has `permission`, and every read is filtered to `ctx.clientId` |
| `portalMutation(permission)`     | Client user              | As above, plus audit                                                              |
| `tokenQuery` / `tokenMutation`   | Signing and pay links    | Token valid, unexpired, scoped to one document or invoice                        |
| `publicHttp`                     | Website, webhooks        | Rate limit, signature or Turnstile verification                                  |
| `internalQuery` / `internalMutation` / `internalAction` | Scheduler, crons, other functions | Not callable from clients               |

The builders put `ctx.principal`, `ctx.permissions`, `ctx.clientId` (portal only) and `ctx.can(permission)` on the
context.

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
`documents.view` `documents.create` `documents.update` `documents.send` `documents.void` `documents.countersign`
`templates.documents.manage`

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

| Area                         | Owner | Admin | Finance | Project manager | Member | Content editor |
| ---------------------------- | :---: | :---: | :-----: | :-------------: | :----: | :------------: |
| Enquiries, deals, clients    | All   | All   | View    | All except delete | —    | —              |
| Contacts, rate card, intake  | All   | All   | View    | All             | —      | —              |
| Projects                     | All   | All   | View all | All            | Assigned | —            |
| Tasks, deliverables          | All   | All   | —       | All             | Assigned | —            |
| Time                         | All   | All   | View all | View, approve  | Own    | —              |
| Change requests, updates     | All   | All   | View    | Create, send    | —      | —              |
| Documents and templates      | All   | All   | View    | Create, update, send | View assigned | —      |
| Countersign documents        | Yes   | Yes   | —       | —               | —      | —              |
| Invoices                     | All   | All   | All     | Create drafts   | —      | —              |
| Payments, credit notes, refunds, write-offs | All | All | All | —          | —      | —              |
| Expenses                     | All   | All   | Approve | Log             | Log    | —              |
| Vendors and bills            | All   | All   | All     | —               | —      | —              |
| Finance reports and exports  | All   | All   | All     | —               | —      | —              |
| Tickets, SLA, monitors, renewals | All | All  | View    | All             | Assigned tickets | —      |
| Vault                        | All   | All   | —       | Assigned, manage | Assigned | —            |
| Team, time off, capacity     | All   | All   | View    | View, capacity  | Request time off | —    |
| Cost rates (sensitive)       | Yes   | Yes   | Yes     | —               | —      | —              |
| CMS                          | All   | All   | —       | View            | —      | Edit, publish  |
| Settings, roles, integrations | All  | All   | Billing settings | —      | —      | —              |
| Audit log, privacy requests  | All   | All   | —       | —               | —      | —              |
| Transfer ownership           | Yes   | —     | —       | —               | —      | —              |

**Client roles**

| Permission area                        | Client admin | Client member |
| -------------------------------------- | :----------: | :-----------: |
| View projects, milestones, updates     | Yes          | Yes           |
| Approve deliverables                   | Yes          | Yes           |
| Approve change requests                | Yes          | —             |
| View documents                         | Yes          | Yes           |
| Sign documents                         | Yes          | Only when named as a signer |
| View and pay invoices                  | Yes          | —             |
| Raise and view tickets                 | Yes          | Yes           |
| Submit credentials to the vault        | Yes          | Yes           |
| Submit intake forms                    | Yes          | Yes           |
| View SLA and retainer reports          | Yes          | —             |
| Invite and remove colleagues           | Yes          | —             |
| Upload files                           | Yes          | Yes           |

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
