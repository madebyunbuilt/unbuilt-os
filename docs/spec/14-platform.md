# 14 — Platform

## Notifications

- One entry point: `notify(event, recipients, data)` (internal mutation) writes in-app notifications and enqueues email
  and WhatsApp messages according to each recipient's preferences and the event's defaults.
- Outbound messages go through a `@convex-dev/workpool` queue with retries and backoff. Provider failures never fail the
  mutation that triggered them.
- In-app: a bell with unread count, a list grouped by day, mark as read, mark all read, links to the target. The bell
  shows the latest ten and scrolls inside its panel; "See all notifications" opens `/notifications` (both surfaces), which
  pages through everything, filters to the unread, and marks all read.
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
- **The three come from one setting** (studio, 2026-09-25): `AUTH_EMAIL_FROM` gives the display name and the domain,
  and the mailbox follows what the mail is for (`convex/lib/senders.ts`). A sandbox address such as Resend's own is
  left exactly as it is, since rewriting it would send from a mailbox that does not exist. `EMAIL_FROM_BILLING` and
  the like override one sender without disturbing the others.
- Templates in `emails/` built with React Email and the brand tokens. Every email has a plain-text part.
- Every send is logged in `messageLog`, linked to the client and record.
- The Resend webhook updates delivery status (delivered, bounced, complained, opened when enabled). A hard bounce flags
  the contact's email as invalid and notifies the record owner.
- **Inbound** for `support@` uses Resend inbound (studio, 2026-09-25: one account and one bill, and the same Svix
  signing the delivery webhook already uses), parsed into tickets (see `09-support-and-sla.md`). A shared secret in an
  Authorization header is accepted **only while `RESEND_WEBHOOK_SECRET` is unset**, so the studio can try the endpoint
  before pointing MX records anywhere, and turning the provider on closes that door rather than leaving two open.

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

| Route                          | Verification                                         |
| ------------------------------ | ---------------------------------------------------- |
| `POST /webhooks/paystack`      | HMAC-SHA512 `x-paystack-signature`                   |
| `POST /webhooks/resend`        | Svix signature headers                               |
| `POST /webhooks/inbound-email` | Svix signature (Resend), else `INBOUND_EMAIL_SECRET` |
| `GET/POST /webhooks/whatsapp`  | Verify token (GET), `X-Hub-Signature-256` (POST)     |
| `POST /public/enquiries`       | Turnstile, origin allowlist, rate limit              |
| `GET /public/site-content`     | Bearer token                                         |

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

How it is built (`convex/lib/files.ts`, `convex/files.ts`):

- Upload contexts: `image` (PNG, JPEG, WebP, GIF, SVG; 10 MB), `document` (images, PDF, Word, Excel, PowerPoint,
  OpenDocument, CSV, plain text; 10 MB), `deliverable` (documents plus ZIP; 100 MB).
- `recordUpload` checks the size and SHA-256 that storage recorded, the declared type against the type storage recorded,
  and the file extension against the type. A file that fails is deleted from storage and the mutation returns
  `{ ok: false, code, message }` rather than throwing, because a thrown error would roll the deletion back.
- File names lose folder parts and control or reserved characters.
- Who may read a file is decided by `FILE_ACCESS`, keyed by the owner record's table. A table with no rule is readable by
  nobody; client users additionally need `visibility = client` and their own `clientId`. Refusals return "not found".
- `teamDownloadUrl` and `portalDownloadUrl` return a link to `GET /files/download` signed with HMAC-SHA256
  (`FILE_URL_SECRET`) that expires in 5 to 6 minutes. The route serves the bytes as an attachment with
  `Cache-Control: private, no-store` and a sandboxing CSP.
- A daily cron deletes uploads more than a day old that were never recorded.

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

`convex/settings.ts` covers the organisation and billing sections: `getOrganisation` and `updateOrganisation`
(`settings.manage`, which also sets and removes the logo), `getBilling` and `updateBilling`
(`settings.billing.sensitive`, which includes bank accounts, numbering, VAT, late fees, payment terms and the invoice
footer). Bank accounts are never returned by the organisation view and are redacted in audit diffs.

The screens live at `/settings/organisation`, `/settings/billing` and `/settings/business-hours`. The settings menu lists every section the role can
reach and marks the ones not built yet. Percentages are typed as percentages with at most two decimals and stored as basis
points (`parsePercentToBps` and `formatBpsAsPercent` in `convex/lib/money.ts`). Changing a number format shows the next
number it will produce and never resets a counter.

Sections, each permission-gated:

- **Organisation**: legal name, address, TIN, VAT number, logo.
- **Billing**: bank accounts, defaults, numbering, late fees, reminders (`settings.billing.sensitive`).
- **Tax**: VAT and WHT defaults.
- **Pipeline stages and lost reasons** (`deals.manage`, at `/settings/pipeline`).
- **Business hours and holidays** (`settings.manage` edits; `sla.manage` sees them read-only): the name, timezone and
  one window per open day; the public holidays for last, this and next year, where estimated dates are confirmed, declared
  days added and added days removed.
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
  - Each host serves its own manifest (`Unbuilt OS`, `Unbuilt client portal`), so they install as separate apps.
  - The service worker (`public/sw.js`, production only) caches only the offline page and its icons, and answers page
    loads with it when the network is unreachable. It never caches app data.
- If the session ends while a page is open (signed out elsewhere, revoked, idle, or the sign-in token cannot be renewed),
  the page shows "Your session has ended" with "Sign in again" and "Try again" (which reloads the page to get a fresh
  token) instead of an error.
- Dark mode following the system with a manual toggle (account menu and command palette). The choice is stored in the
  browser and applied by an inline script in the root layout before first paint.
- Responsive to 360 px wide: a sidebar from 1024 px, a slide-out menu below.
- Keyboard shortcuts for common actions, listed under `?`. `⌘K` / `Ctrl K` opens the command palette.
- Navigation shows each module the role can use (any of the module's permissions). Modules not built yet stay in the
  menu in the drawing colour, marked "Not built yet", and cannot be opened.
- The notifications bell shows the unread count (capped at 99+) in hi-vis, the latest 50 notifications grouped by day in
  the viewer's timezone, and marks items read when opened. Links in notifications must be in-app paths.

## Acceptance criteria

- A provider outage for email or WhatsApp does not fail the triggering action, and the message is retried.
- Every webhook route rejects bad signatures and processes duplicate events once.
- Search and the command palette never return records outside the caller's permissions or scope.
- Reports match fixture data and use stored FX rates.
- Downloading a file without permission fails even with a previously obtained file id.
- CSV import dry run reports row errors without writing; imported invoice numbers never collide with new ones.
- Full export excludes plaintext secrets and is recorded in the audit log.
