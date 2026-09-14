# 09 — Support, SLAs, monitoring and renewals

## SLA policies

- A policy has a business hours calendar and targets per priority:

| Priority | Meaning                             | Default first response | Default resolution |
| -------- | ----------------------------------- | ---------------------- | ------------------ |
| P1       | Production down or data at risk     | 1 business hour        | 8 business hours   |
| P2       | Major feature broken, no workaround | 4 business hours       | 3 business days    |
| P3       | Minor issue or workaround exists    | 1 business day         | 10 business days   |
| P4       | Question or small change request    | 2 business days        | Best effort        |

- Optional: included support minutes per month (linked to a retainer) and an uptime target.
- Clients and projects reference a policy. A ticket uses the project's policy, then the client's, then none.
- Seed three policies: Standard, Priority, Retainer.

## Business hours and holidays

- A calendar has a timezone and weekly hours. Default: Monday to Friday, 09:00 to 17:00, `Africa/Lagos`.
- `holidays` holds Nigerian public holidays. Seed the fixed-date holidays for the current and next year:
  - New Year's Day
  - Workers' Day
  - Democracy Day
  - Independence Day
  - Christmas Day
  - Boxing Day
- Seed placeholder rows for movable holidays with a flag that they need confirming each year:
  - Good Friday
  - Easter Monday
  - Eid al-Fitr
  - Eid al-Adha
  - Mawlid
- Government-declared holidays are added manually.
- `convex/lib/businessTime.ts` provides `addBusinessMinutes(start, minutes, calendar, holidays)` and
  `businessMinutesBetween(a, b, calendar, holidays)`. All SLA timers use these.
- A cron on 2 January adds the standard holidays for the year and the next, then notifies `settings.manage` holders to
  confirm the movable holidays (or to add them when there are no estimates for the year).
- `settings.manage` and `sla.manage` can see business hours and holidays; only `settings.manage` changes them (decided by
  the studio on 2026-09-14). Saving a holiday's date confirms it, and the date stays within its year. A year has one
  holiday per name, so the seed recognises a movable holiday after its date moves; extra declared days get their own
  name, such as "Eid al-Fitr (second day)". Holidays added by hand can be removed; standard ones can only be re-dated.

## Tickets

- **Channels**:
  - the portal
  - team-created on a client's behalf
  - email to `support@unbuilt.studio`, parsed from an inbound email webhook
  - uptime monitors (automatic P1 or P2)
- **Email tickets**: a new email from a known contact creates a ticket; a reply to a ticket notification appends a
  message. An email from an unknown sender creates an unassigned ticket flagged for triage.
- **Fields**: number (`UNB-TKT-0001`), client, project, priority, status, requester, assignee, subject, description,
  attachments.
- **Timers** start at creation:
  - `firstResponseDueAt` and `resolutionDueAt` from the policy.
  - The first public reply from the team sets `firstRespondedAt`.
  - Status `pending_client` pauses the resolution timer; the paused business minutes are added to the due time on resume.
  - `resolved` stops it.
  - A client reply within 7 days reopens a resolved ticket; after that, a new ticket is created referencing the old one.
- **Breach warnings** fire at 75% of each target and on breach, to the assignee, the project manager and admins. A P1
  breach also sends WhatsApp to admins.
- Time logged against a ticket counts toward the project and, for retainers, the retainer period.
- Messages are public (visible to the client) or internal notes.

## Retainer hours

- Used minutes for the current period come from approved time entries on the retainer's project.
- The portal shows included, used and remaining hours for the current period, and a history of past periods.
- Alerts at 80% and 100% (see `08-billing-and-finance.md`).

## Monthly SLA report

- On the first business day of each month, generate a report per client with an SLA policy:
  - tickets opened and resolved by priority
  - first response and resolution compliance percentage per priority
  - breaches with reasons
  - uptime per monitor against target
  - incidents
  - retainer hours used
- The project manager reviews and sends it; it is then emailed as a PDF and posted in the portal. Unsent reports remind
  the manager after 3 business days.

## Uptime monitoring

- Monitors check a URL on an interval (default 5 minutes) from a Convex cron using an internal action with a timeout.
- A check passes when the status code matches the expected code within the timeout.
- **Two consecutive failures** open an incident, notify the project team, and create a P1 ticket (or P2 for
  non-production URLs).
- The first passing check after an incident resolves it, notifies the team and adds a message to the ticket.
- Uptime % = passing checks / total checks for the period, excluding paused time. Check history is kept for 90 days;
  monthly uptime figures are stored permanently on the SLA report.

## Managed assets and renewals

- Assets the studio manages for clients:
  - domains
  - hosting
  - SSL certificates (when not auto-renewing)
  - app store developer accounts
  - subscriptions
- Each records provider, renewal date, cost to the studio and price billed to the client.
- **Reminders** 60, 30, 14 and 7 days before renewal go to the project manager. From 30 days they also go to the
  client's billing contacts, with the renewal invoice attached when `autoInvoice` is on.
- `autoInvoice` creates the renewal invoice draft 30 days before the date.
- An asset past its renewal date without being marked renewed alerts admins daily.
- Transferring an asset to the client (for example at handover) sets its status to `transferred` and stops reminders.

## Acceptance criteria

- SLA due times skip weekends, holidays and out-of-hours time, verified by tests including a holiday on a Friday and a
  ticket created at 16:55.
- `pending_client` pauses the resolution timer and the pause is added back correctly.
- The 75% warning and breach notifications each fire once per ticket per target.
- An inbound email reply is appended to the right ticket; an unknown sender creates a flagged ticket.
- Two consecutive failed checks open exactly one incident and one ticket; recovery resolves both.
- Monthly SLA compliance and uptime figures match fixture data.
- Renewal reminders fire at each threshold once, and transferred assets receive none.
