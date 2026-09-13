# 14 — Platform

## Notifications

- One entry point: `notify(event, recipients, data)` (internal mutation) writes in-app notifications and enqueues email
  and WhatsApp messages according to each recipient's preferences and the event's defaults.
- Outbound messages go through a `@convex-dev/workpool` queue with retries and backoff. Provider failures never fail the
  mutation that triggered them.
- In-app: a bell with unread count, a list grouped by day, mark as read, mark all read, links to the target.
- Preferences per event and channel for team members and client users. Security and legal events (sign-in, signed
  copies, payment receipts) cannot be turned off for email.

### Event catalogue (defaults)

| Event                                    | Recipients                          | In-app | Email |   WhatsApp    |
| ---------------------------------------- | ----------------------------------- | :----: | :---: | :-----------: |
| Enquiry received                         | `enquiries.manage`                  |   ✓    |   ✓   |       ✓       |
| Deal follow-up due                       | Deal owner                          |   ✓    |   ✓   |               |
| Document viewed                          | Document owner                      |   ✓    |       |               |
| Signature requested                      | Signer (client or team)             |        |   ✓   |       ✓       |
| Document signed / declined               | Owner, signers                      |   ✓    |   ✓   |               |
| Deliverable ready for review             | Client contacts on project          |   ✓    |   ✓   |       ✓       |
| Deliverable approved / changes requested | Project manager, submitter          |   ✓    |   ✓   |               |
| Change request sent                      | Client admins                       |   ✓    |   ✓   |       ✓       |
| Change request decided                   | Project manager                     |   ✓    |   ✓   |               |
| Invoice sent                             | Billing contacts                    |   ✓    |   ✓   |       ✓       |
| Invoice due / overdue reminders          | Billing contacts                    |        |   ✓   |       ✓       |
| Payment received                         | Billing contacts (receipt), Finance |   ✓    |   ✓   |               |
| Ticket created                           | Assignee or triage group            |   ✓    |   ✓   |               |
| Ticket reply                             | The other side                      |   ✓    |   ✓   |  ✓ (client)   |
| SLA 75% / breached                       | Assignee, PM, admins                |   ✓    |   ✓   | ✓ (P1 breach) |
| Monitor down / recovered                 | Project team, admins                |   ✓    |   ✓   |       ✓       |
| Retainer 80% / 100%                      | PM, client admins                   |   ✓    |   ✓   |               |
| Renewal upcoming                         | PM, billing contacts from 30 days   |   ✓    |   ✓   |               |
| Time off requested / decided             | Approvers / requester               |   ✓    |   ✓   |               |
| Weekly update sent                       | Client contacts on project          |   ✓    |   ✓   |               |
| @mention                                 | Mentioned member                    |   ✓    |   ✓   |               |
| Bill due                                 | `bills.pay`                         |   ✓    |   ✓   |               |

## Email (Resend)

- Sending domain `unbuilt.studio` with SPF, DKIM and DMARC records set up before launch. From addresses:
  - `notifications@` for system mail
  - `billing@` for invoices and receipts
  - `support@` for tickets
- Templates in `emails/` built with React Email and the brand tokens. Every email has a plain-text part.
- Every send is logged in `messageLog`, linked to the client and record.
- The Resend webhook updates delivery status (delivered, bounced, complained, opened when enabled). A hard bounce flags
  the contact's email as invalid and notifies the record owner.
- **Inbound** for `support@` uses an inbound email webhook (Resend inbound, or Postmark inbound if unavailable), parsed into
  tickets (see `09-support-and-sla.md`).

## WhatsApp (Meta Cloud API)

- Business-initiated messages use pre-approved templates only, one per event marked ✓ above, with variables for names,
  numbers and links. Template names live in `convex/integrations/whatsapp/templates.ts`.
- Messages are sent only to contacts and members with recorded opt-in and a valid E.164 number.
- The status webhook updates `messageLog`.
- Replies received within the 24-hour window are logged on the contact's timeline and, for ticket-related messages,
  appended to the ticket.
- If WhatsApp fails or the template is not approved, the email still goes out.

## Webhooks and public HTTP

All in `convex/http.ts`:

| Route                          | Verification                                     |
| ------------------------------ | ------------------------------------------------ |
| `POST /webhooks/paystack`      | HMAC-SHA512 `x-paystack-signature`               |
| `POST /webhooks/resend`        | Svix signature headers                           |
| `POST /webhooks/inbound-email` | Provider signature or basic auth secret          |
| `GET/POST /webhooks/whatsapp`  | Verify token (GET), `X-Hub-Signature-256` (POST) |
| `POST /public/enquiries`       | Turnstile, origin allowlist, rate limit          |
| `GET /public/site-content`     | Bearer token                                     |

Rules for every webhook:

1. Verify the signature before parsing.
2. Insert into `webhookEvents` keyed by provider and event id; if it already exists, return 200 and stop.
3. Schedule an internal action to process it, then return 200 quickly.
4. Processing is idempotent and tolerates out-of-order events (for example a refund arriving before its charge is
   recorded retries later).
5. Failures are recorded with the error and retried with backoff; after 5 failures, admins are notified.

## Search and command palette

- Convex search indexes on:
  - clients and contacts
  - deals
  - projects
  - documents
  - invoices (number)
  - tickets
  - works, posts
  - vault item labels
- ⌘K / Ctrl+K opens the palette:
  - search across entities, filtered by the caller's permissions and project scope
  - jump to pages
  - quick actions: new invoice, new ticket, log time, start timer, new deal
- Results never include records the caller cannot open.

## Dashboards and reports

**Home dashboard** by role:

- **Admin**: revenue this month, outstanding balance, overdue, pipeline, SLA breaches, monitors down, renewals due.
- **Finance**: ready-to-send invoices, overdue, WHT credits outstanding, bills due, cash received.
- **PM**: projects at risk, approvals pending, tickets near breach, unsent updates.
- **Member**: my tasks, my tickets, timesheet status.
- **Content editor**: drafts, scheduled posts, last publish.

**Reports** (with permission), in NGN using stored FX rates, with a currency filter:

| Report                | Content                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| Revenue               | Invoiced and received by month, client, service type, project                          |
| Receivables aging     | Balances in 0–30, 31–60, 61–90, 90+ day buckets by client                              |
| Pipeline              | Value and weighted value by stage, owner, expected close month; win rate; lost reasons |
| Project profitability | Billed − (time × cost rate) − expenses − bills, margin %, per project and type         |
| Utilisation           | Billable and non-billable hours per member, utilisation %                              |
| SLA compliance        | Response and resolution compliance by client, priority and month; uptime               |
| WHT credits           | Expected vs certificate received, by client and age                                    |
| VAT summary           | VAT charged by month and treatment                                                     |
| Expenses and bills    | By category, vendor, project                                                           |

Use `@convex-dev/aggregate` (or maintained summary tables updated in the same mutations) for totals; never scan whole
tables in a query.

## Files

- Upload through Convex storage upload URLs after a permission check. `files` stores metadata, SHA-256, owner record,
  client, project and visibility.
- Downloads go through a query that checks permission and scope, then returns a short-lived URL. Storage ids are never
  exposed to clients directly.
- Allowed types by context (images, PDF, Office documents, archives for deliverables). Maximum size 100 MB for
  deliverables, 10 MB elsewhere.
- Client-visible files only appear in the portal when `visibility = client`.

## Imports and exports

- **Imports** (`imports.run`) from CSV with a column-mapping step, a dry run showing errors per row, then import:
  - clients
  - contacts
  - deals
  - projects
  - historical invoices and payments (marked as imported, with original numbers kept and counters set above the highest
    imported number)
  - vendors
  - rate card
- **One-off website migration**: an internal action that imports the website's current `content/*.ts` data (provided as
  JSON) into works, service pages, legal pages and site settings as published content.
- **Exports**:
  - CSV for any list the user can see, with `*.export` permissions for sensitive lists
  - Owner-only full JSON export of all tables (secrets remain encrypted), logged in the audit log

## Settings

Sections, each permission-gated:

- **Organisation**: legal name, address, TIN, VAT number, logo.
- **Billing**: bank accounts, defaults, numbering, late fees, reminders (`settings.billing.sensitive`).
- **Tax**: VAT and WHT defaults.
- **Pipeline stages and lost reasons.**
- **Business hours and holidays.**
- **SLA policies.**
- **Templates**: documents, projects, intake forms, checklists.
- **Roles and permissions.**
- **Notifications defaults.**
- **Integrations**: Paystack keys, Resend, WhatsApp, Google, Turnstile, deploy hook (`integrations.manage`, secrets stored
  as Convex environment variables where possible and shown masked).
- **Legal toggles**: signature process reviewed, templates reviewed.
- **Data retention.**

## App shell

- Installable PWA for both surfaces: manifest, icons from the brand kit, offline page. No offline data editing.
- Dark mode following the system with a manual toggle.
- Responsive to 360 px wide.
- Keyboard shortcuts for common actions, listed under `?`.

## Acceptance criteria

- A provider outage for email or WhatsApp does not fail the triggering action, and the message is retried.
- Every webhook route rejects bad signatures and processes duplicate events once.
- Search and the command palette never return records outside the caller's permissions or scope.
- Reports match fixture data and use stored FX rates.
- Downloading a file without permission fails even with a previously obtained file id.
- CSV import dry run reports row errors without writing; imported invoice numbers never collide with new ones.
- Full export excludes plaintext secrets and is recorded in the audit log.
