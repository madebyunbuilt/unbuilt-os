# 11 — Team

## Members and contractors

- `team.manage` invites people by email with a role. The invite email leads to sign-in and mandatory 2FA setup.
- Profile: name, title, employment type (employee or contractor), phone, WhatsApp, timezone, skills, start date,
  capacity per week, avatar.
- **Rates** (sensitive, `team.rates.sensitive`): cost rate and bill rate with currency. Rate changes apply to new time
  entries only.
- Contractors can be linked to a vendor record so their invoices are handled as bills.
- **Agreements**: each member has documents from the documents module (NDA, contractor agreement, employment contract),
  signed through the same e-signature flow. The profile shows missing or expired agreements.

### Decisions and rules (studio, 2026-09-14)

- **Invitations** expire 14 days after they are sent; resending renews them for another 14 days. An expired invitation
  cannot create an account. The seeded Owner invitation does not expire. The email ("Accept invitation") links to
  `/sign-in` with the address filled in; the link itself grants nothing. Invitations nobody accepted can be cancelled,
  which removes the record.
- An address can belong to one principal only: inviting an address that is already a team member or a client contact is
  refused. Re-inviting an offboarded member is not supported yet.
- **Nobody grants more than they hold**: inviting someone, or changing, suspending or offboarding them, needs every
  permission of the role involved (the same rule as saving roles).
- Nobody changes their own role or status. The Owner's role changes only through **ownership transfer**
  (`owner.transfer`), which needs an active member with 2FA as the new Owner and makes the previous Owner an Admin in the
  same mutation.
- Members edit their own phone, WhatsApp (E.164), timezone, skills and photo; `team.manage` edits the rest.
- Suspending and offboarding revoke sessions at once. Offboarding keeps the record and its history. The project, task,
  ticket and vault steps of offboarding are added by those modules.
- The "2FA enabled" onboarding item is ticked automatically and cannot be edited; other items record who ticked them.
- Time off: nobody approves, declines, records or cancels their own time off as an approver, except the Owner.

### Screens

- `/team` lists members (search, include offboarded, invite) for `team.view`; people without it go to `/team/me`.
- `/team/[id]` shows the profile. `team.manage` edits it, resends or cancels an invitation, changes the role, suspends,
  reactivates and offboards (with a confirmation and the last day). Rates appear only when the query returns them. The
  Owner sees "Transfer ownership", confirmed by typing the member's name; it is offered only for active members with 2FA.
- `/team/me` lets anyone update their photo, phone, WhatsApp, timezone and skills, and shows their onboarding checklist.
- The role list offers only roles the viewer may give (`team.assignableRoles`). A member whose role holds more than the
  viewer has their role shown but not editable.
- The role of a pending invitation can be changed before they accept; suspend and offboard appear only after they
  accept. The email they already have names the old role until the invitation is resent.
- Employment type (employee or contractor) describes how someone works with the studio. It does not limit which roles
  they can have; access comes only from the role.
- Invitation emails open `/sign-in` with the invited address filled in.

## Onboarding and offboarding

- **Onboarding checklist** on invite (defaults, editable):
  - NDA signed
  - Agreement signed
  - 2FA enabled
  - Added to projects
  - Tools access granted
- **Offboarding** (`team.manage`) sets the status to offboarded and does the following, in one mutation plus follow-ups:
  - revokes sessions
  - removes project memberships
  - reassigns open tasks and tickets (prompt for the new assignee)
  - lists vault items the member revealed in the last 90 days for rotation
  - keeps all history attributed to them

## Time off

- Members request time off (`timeoff.request`): type, dates, half day, note.
- `timeoff.approve` holders approve or decline; the member is notified.
- Approved time off reduces capacity and shows on the team calendar and project timelines.
- Public holidays from `holidays` apply to everyone automatically.

### Decisions and rules (studio, 2026-09-14)

- Dates are whole days in the studio's timezone. A half day covers a single date. Requests count **working days**: days
  with default business hours that are not public holidays. A request with no working days is refused, and a member's
  requested or approved time off cannot overlap.
- Members request annual, sick, unpaid or other leave. `public` is not requested; public holidays come from `holidays`.
- **Privacy**: the type, note and decision note are visible only to the member and `timeoff.approve` holders. Everyone
  else with `team.view` sees only that the person is off, and only once approved.
- **Cancelling**: members withdraw their own pending requests at any time and cancel their approved time off until its
  first day. After that, an approver cancels it.
- **Recording for someone**: an approver can enter time off for another active member, such as sick leave phoned in. It
  is approved at once and records the approver as the person who entered and approved it.
- Notifications (in-app now; email with the communications step): approvers on a request; the member on a decision,
  on time off recorded for them, and when an approver cancels theirs; the approver when a member cancels approved time
  off.
- Offboarding cancels the member's pending requests and approved time off that starts after their last day.

## Capacity planning

`capacity.view` shows, per member and per week for the next 12 weeks:

- **Available** = capacity − approved time off − public holidays.
- **Planned** = task estimates due that week, and retainer commitments.
- **Tentative** = weighted demand from open deals with expected close dates (value converted to hours using the
  average bill rate, times probability), shown separately.
- Over-allocation is highlighted when planned exceeds available.

## Utilisation

With `reports.delivery.view`, per member and period:

- billable hours
- non-billable hours
- utilisation = billable / available

## Acceptance criteria

- An invited member cannot use the team app until 2FA is enabled.
- A rate change does not alter existing time entries.
- Offboarding revokes sessions and memberships immediately and leaves no open task or ticket unassigned without a prompt.
- Available capacity excludes approved time off and public holidays, verified with fixtures.
- Members without `team.rates.sensitive` never receive rate fields.
