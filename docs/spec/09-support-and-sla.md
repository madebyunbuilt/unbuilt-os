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
  - **A reply is threaded by the ticket number in its subject** (studio, 2026-09-25), not by `In-Reply-To`: the number
    survives forwarding, quoting and mail software that drops headers. It is a claim, not a credential — a reply joins
    a ticket only when the sender's contact belongs to that ticket's client, or, for somebody still unplaced, when the
    address matches the one that opened it. Quoting somebody else's number gets you your own ticket, not theirs.
  - **An emailed reply takes the same path a portal reply takes**, so the seven-day reopen rule, the pause resuming
    and the notifications behave identically whichever door the client came through. One rule rather than two that
    could drift.
  - **Email says nothing about urgency**, so an emailed ticket starts at P3 and is raised by hand from there.
  - **Unbuilt OS's own mail never opens a ticket** (studio, 2026-09-27), nor does a robot mailbox (`noreply`,
    `mailer-daemon`, `postmaster` and the like) on any domain. Two reasons, the second serious: a support address that
    answers its own system is a loop, and asking Unbuilt OS for a sign-in link at the support address would deliver
    that link into a ticket, which anybody holding `tickets.view.all` could then use. A bounce is a delivery failure
    to act on, not a client with a problem. The refused addresses come from the same setting the from line uses, so a
    sender added later cannot be forgotten here. Refused mail is recorded on its webhook event as `ignored`, with the
    reason, so a missing email can be traced rather than vanishing.
  - **Somebody at the studio emailing support raises a ticket** (studio, 2026-09-27), attributed to them, exactly as
    though they had taken the call. The line is between the studio's system and the studio's people, not between
    domains: refusing a member's email would lose the very work somebody bothered to report. It still needs triage,
    because an email cannot say which client it is about, and the notification names who sent it so whoever places it
    knows who to ask.
  - **A ticket awaiting triage has no client**, and therefore no policy and no promise: it is never late, and it
    reaches no client in the portal, because every portal query is scoped by client. Placing it works the promise out
    **from when the email arrived**, not from when somebody got round to it — an email that sat unread for three days
    really is three days late, and hiding that would hide the only thing worth knowing about it.
  - Placing it is a screen, not a database chore: an unplaced email sits at the top of the studio's list, since
    nothing is counting down for it.
- **Fields**: number (`UNB-TKT-0001`), client, project, priority, status, requester, assignee, subject, description,
  attachments.
- **Attachments belong to a message, not to the ticket** (studio, 2026-09-25): a screenshot means little without the
  words it came with. Either side can attach up to five files per message, images and documents up to 10 MB each — the
  `document` upload context, not the deliverable one, since support is not where large files belong.
  - **A file on an internal note is marked internal** and never reaches the portal, which the shared file rule in
    `convex/lib/files.ts` enforces whatever a screen does. A file on a public message is marked client-visible.
  - **A file the studio cannot accept fails the whole message.** A reply that quietly lost its screenshot is worse
    than one that did not send, because only the second tells anybody.
  - For the studio, a ticket's files follow the same rule as seeing the ticket; for a client, the whole company can
    read them, as the whole company can read the ticket.
  - A message with only a file and no words is worth sending, so both screens allow it.
- **Timers** start at creation:
  - `firstResponseDueAt` and `resolutionDueAt` from the policy.
  - The first public reply from the team sets `firstRespondedAt`.
  - Status `pending_client` pauses the resolution timer; the paused business minutes are added to the due time on resume.
  - `resolved` stops it.
  - A client reply within 7 days reopens a resolved ticket; after that, a new ticket is created referencing the old one.
  - **A reopened ticket is promised afresh** (studio, 2026-09-25), from the moment the client came back, under the same
    policy and priority: a new reply time as well as a new fix time, and the warning and breach stamps cleared. The
    thread and the number are kept, which is the difference between reopening and starting again. Keeping the original
    due times instead would make a ticket resolved on time breach the instant somebody said it was not fixed, which
    tells the studio nothing it can act on. `promisedFrom` on the ticket is the instant the current promise runs from,
    and it is what a later change of priority counts from.
- **Breach warnings** fire at 75% of each target and on breach, to the assignee, the project manager and admins. A P1
  breach also sends WhatsApp to admins.
  - The warning instants are stored beside the due times when the ticket is raised, and move with them, so a warning is
    always three-quarters of the promise the ticket actually carries.
  - Checked every fifteen minutes. A P1 has one business hour to be answered, so anything slower would warn too late to
    be worth sending.
  - **A target already missed is not warned about** (studio, 2026-09-25): being told a deadline is three-quarters gone,
    when it went hours ago, is worse than being told nothing. The warning is recorded as spent so it can never arrive
    after the breach it was meant to prevent.
  - **A ticket waiting on the client is not running late**: its resolution clock is stopped, and its due time moves out
    by whatever the wait costs when it resumes, so neither warning nor breach fires while it is `pending_client`.
  - The stamps on the ticket record what was **sent**, not what is currently true. Downgrading a breached ticket does
    not un-send the breach, and does not make it eligible to be sent again.
  - **Admins** here means the holders of `settings.manage`, as in the January holiday reminder.
- Time logged against a ticket counts toward the project and, for retainers, the retainer period. It is logged from
  the ticket itself, and the ticket shows what it has taken so far. **A ticket with no project cannot take time**
  (studio, 2026-09-26): a time entry belongs to a project, and recording it against nothing would lose it — the screen
  says to put the ticket on a project rather than offering a control that would be refused.
- Messages are public (visible to the client) or internal notes.
- **What was asked for is the first message** (studio, 2026-09-25), not a separate description field: the thread then
  reads in order from the start, and a reply and an opening request are the same kind of thing.
- **The promise is written onto the ticket when it is raised** (studio, 2026-09-25): the policy, the due times and the
  calendar it was counted in are stored, not worked out on read. Retiring a policy or editing business hours afterwards
  changes what the studio promises next, never a date a client was already given. A ticket raised when no policy
  applies has no due times at all rather than invented ones, and is never late.
- **Changing the priority re-runs the promise** (studio, 2026-09-25) from when the ticket was raised, under the new
  priority's targets, plus whatever it has already spent waiting on the client. Escalating a P3 to a P1 therefore makes
  it due sooner — often already late — which is the point of escalating it. A first response that has already happened
  is not taken back: that target only matters until somebody replies.
- **Reading a ticket that is not there answers with nothing** (studio, 2026-09-26), rather than an error: a bookmark, a
  stale link or a notification for a ticket since deleted should say so on the page. A role with no ticket permission
  at all is still refused outright — that is a different answer to a different question.
- **Who sees a ticket**: `tickets.view.all` reaches every one. `tickets.view.assigned` reaches tickets on a project the
  member belongs to, and tickets assigned to them, which is what makes a ticket raised against a client with no project
  reachable by the person holding it. Anything out of scope is "not found", as everywhere else.

## Screens

- **The studio's list is ordered by what is promised**, not by what is newest: whatever is closest to running out sits
  at the top, and a ticket waiting on the client sits below the ones with a clock running, because its clock is stopped.
- **Timers are shown in words** ("Reply due in 55 minutes", "Reply 3 hours late") rather than as timestamps, with the
  exact due moment beside them on the ticket itself. The gap is wall-clock, not business time: it answers "how long
  have I got", and the person reading it knows their own evening better than a label could.
- **A ticket with no policy says so**, rather than showing an empty clock that could be read as comfortably fine.
- **An internal note is visibly internal** wherever it appears, and the reply box says which kind is being written. A
  note carries the reminder that it does not count as the first reply, since the client has still heard nothing.
- The studio's pages are under `/support/tickets`; `/tickets` belongs to the portal.

## What a client sees

- **Being waited on is a notification** (studio, 2026-09-25), not only a badge: moving a ticket to `pending_client`
  tells the client, unless the studio has just replied — that reply is itself the telling, and two notifications for
  one action is noise. Without this the ticket goes quiet on both sides, since the studio's clock has stopped too.
- **Ticket notifications go to every colleague with portal access**, not only whoever raised it, because the portal
  shows a client their whole company's tickets.
- **The studio's statuses are not the client's**: `new` and `open` both mean Unbuilt has it, so the portal says "With
  Unbuilt". `pending_client` reads as "Waiting on you", with a line saying Unbuilt is waiting on an answer.
- **No SLA anywhere in the portal** (studio, 2026-09-25): no due times, no countdown, no policy name. What the studio
  promised is what the studio is scored on, and a client watching a clock tick down learns nothing they can act on.
  The monthly SLA report is where compliance is reported, deliberately after the fact.
- **A client and the studio read the same report** (studio, 2026-09-26), rendered by one component from the same
  stored figures. Two versions would eventually disagree, and the one the client held would be the one that mattered.
  A draft is absent from the portal entirely: until somebody at the studio has read a month, it is a working paper and
  not a statement about anything.
- **Priorities are offered in the client's words**, not as P-codes: "Everything is down, or data is at risk" rather
  than P1.
- **Internal notes are absent from every portal response**, not hidden by the screen.
- A client sees **their whole company's tickets**, not only the ones they raised themselves, as with projects,
  documents and invoices. A colleague picking up somebody's report is the normal case.
- The portal says **before they type** whether a reply will reopen the ticket or start a new one.

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
- **The figures are worked out once and stored** (studio, 2026-09-26): a report is a statement about a month that has
  closed, and must read the same in a year as it did on the day. It is written once per client per month, so running
  the cron twice, or catching a month up by hand, never hands a client a second version.
- **A ticket counts toward the month it was raised in**, so a report covers what the client asked for in that month
  rather than whatever happened to be open when it ended.
- **A priority nothing came up under is left blank, not scored** (studio, 2026-09-26): a month with no P1 tickets did
  not meet its P1 target, it simply never had one, and 100% would be a claim about work that never existed.
- **A ticket still unresolved past its fix time is a missed target**, counted to the end of the month rather than to
  now — otherwise an old report would grow every time somebody opened it.
- **Why a target was missed is written by a person** (studio, 2026-09-26), on the ticket, and carried into the report.
  Nothing else can supply it: the system knows a promise was missed, never why.
- **Nothing is sent without somebody reading it.** A report that went out on its own would eventually tell a client
  something nobody at the studio had looked at.
- Until monitoring lands (`12`), a report says outright that nothing was monitored rather than showing an empty
  uptime section, which would read as though nothing had gone wrong.

## Uptime monitoring

- Monitors check a URL on an interval (default 5 minutes) from a Convex cron using an internal action with a timeout.
- A check passes when the status code matches the expected code within the timeout.
- **Two consecutive failures** open an incident, notify the project team, and create a P1 ticket (or P2 for
  non-production URLs).
- The first passing check after an incident resolves it, notifies the team and adds a message to the ticket.
- Uptime % = passing checks / total checks for the period, excluding paused time. Check history is kept for 90 days;
  monthly uptime figures are stored permanently on the SLA report.
- **A monitor may not point inside a private network** (studio, 2026-09-26): not `localhost`, not a private range, not
  the cloud metadata address. Otherwise anyone who can add a monitor could make the studio's own servers fetch things
  on their behalf, and read back the status and timing.
- **A monitor starts paused** and claims nothing until it has actually been checked. Starting as "up" would mean the
  first screen a person sees is a guess.
- **Paused time is not counted against uptime**: the studio was asked not to look, so the period simply does not
  include it.
- **The recovery message is public on the ticket**, because it was the client's own site that was down and the ticket
  is where they will look.
- **Whatever is down comes first** on the studio's list, then whatever is not being checked, then the rest. Ordering by
  name would bury the one thing on the page that needs somebody.
- **A monitor that has never been checked shows no uptime figure**, not 100%: no checks is not a perfect record. The
  same distinction the SLA report makes about a priority nothing came up under.
- **A monitor can be changed, but not into a different site** (studio, 2026-09-27): the interval, timeout, name,
  method, expected status, project and live-site flag all move freely, and so does the path or the scheme, because
  those are still the same site and the history stays meaningful. A different **host** is a different thing being
  watched, and keeping the old checks would make the uptime figure a blend of two sites — a figure that is stored on a
  client's SLA report for good and could never be explained afterwards. That is a new monitor. A changed address is
  written to the client's timeline either way.
- **Uptime is shown to two decimals near the top** (99.90%, 99.99%), because the difference between those is the whole
  reason for measuring, and to one further down where it is not.

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
- **Each threshold fires once per renewal date**, recorded on the asset. Moving the date by hand, or renewing it,
  clears what was said: a different date is a different renewal and is told about from scratch.
- **A missed threshold is still sent** (studio, 2026-09-27): an asset added eight days before its date, or a week
  nobody looked at, sends one message naming the nearest threshold rather than none. The point is that somebody knows,
  not that a calendar was kept — and one message, not four for the thresholds that went by.
- **Renewing asks for the next date rather than assuming one** (studio, 2026-09-27): a domain runs a year, hosting a
  month, a certificate whatever it was bought for, and the data model records no period. A year on is offered as a
  starting point, since that is what a domain almost always means, but guessing would put a date somebody trusted in
  front of them. The 29th of February renews on the 28th rather than slipping into March.
- **`autoInvoice` needs a price to invoice**: an asset the studio does not bill on cannot be set to invoice
  automatically, and the price and its currency are given together or not at all.
- **The list answers one question**: what is about to lapse. Soonest first, and something already past its date is the
  loudest thing on the page, because every day it stays lapsed is worse than the last.
- **A renewal invoice is attributed to whoever added the asset**, as a scheduled invoice and a late fee already are.
  An invoice nobody raised has nobody to ask about it.

## Acceptance criteria

- SLA due times skip weekends, holidays and out-of-hours time, verified by tests including a holiday on a Friday and a
  ticket created at 16:55.
- `pending_client` pauses the resolution timer and the pause is added back correctly.
- The 75% warning and breach notifications each fire once per ticket per target.
- An inbound email reply is appended to the right ticket; an unknown sender creates a flagged ticket.
- Two consecutive failed checks open exactly one incident and one ticket; recovery resolves both.
- Monthly SLA compliance and uptime figures match fixture data.
- Renewal reminders fire at each threshold once, and transferred assets receive none.
