# 05 — CRM

## Enquiries

- The website's enquiry sheet posts to the Convex HTTP endpoint `POST /public/enquiries` (see
  `13-cms-and-website.md`). Fields match the existing form: `services[]`, `stage`, `budget`, `timeline`, `about`,
  `name`, `email`, `company`, plus a Turnstile token.
- The endpoint verifies Turnstile, applies a rate limit per IP and per email, and stores an `enquiries` row.
- A new enquiry notifies everyone with `enquiries.manage` (in-app, email, WhatsApp by preference) and replies to the
  sender with an acknowledgement email.
- The enquiry inbox lists new enquiries first. Actions: **Convert** (creates or matches a client by email domain or
  company name, creates a contact and a deal in the first open stage, links the enquiry), **Mark spam**, **Close**.
- Duplicate detection: an enquiry from an email that already belongs to a contact shows that client and their open deals.

## Pipeline and deals

- Stages are editable (`pipelineStages`), each with a default probability. Defaults: New (10%), Discovery (25%),
  Proposal sent (50%), Negotiation (75%), Won (100%), Lost (0%).
- Kanban board and table views. Dragging a deal between stages records a `status_change` activity.
- Each deal has: value and currency, probability (defaults from the stage, editable), expected close date, owner,
  services, source, next follow-up date.
- **Follow-ups**: a deal with no activity and no future follow-up for 7 days notifies its owner. A follow-up date that
  passes without activity notifies the owner that day.
- **Won** requires choosing or creating the project (optionally from a template) and links the accepted documents.
  **Lost** requires a lost reason from a configurable list plus free text.
- Pipeline value = sum of open deal values; weighted value = sum of value × probability, both converted to NGN at
  today's rate for display only.

## Clients

- List with filters: status, owner, tag, industry, has overdue invoices, has open tickets.
- Client page tabs:
  - **Overview**: status, owner, key figures (lifetime billed, outstanding balance, open deals, active projects, open tickets),
    recent activity.
  - **Contacts**
  - **Deals**
  - **Projects**
  - **Documents**
  - **Invoices and payments**: with a statement of account.
  - **Tickets**
  - **Vault**: permission-gated.
  - **Assets**: renewals.
  - **Files**
  - **Activity**: the full timeline.
  - **Settings**: billing details, VAT treatment, WHT, currency, payment terms, SLA policy, portal access.
- **Billing details** used by invoices: legal name, address, TIN, VAT treatment (standard, zero-rated, exempt), whether
  WHT applies and at what rate, default currency, payment terms.
- **Status** moves from lead to active automatically when the first project starts, and to past when the last project
  completes with no active retainer. Manual override is allowed and recorded.

## Contacts

- A client has many contacts. Flags: primary, billing (receives invoices), portal access, WhatsApp opt-in.
- **Portal invitation**: enabling portal access sends a magic-link invite and assigns a client role (default Client
  member; the first contact invited becomes Client admin).
- **WhatsApp opt-in** must be recorded with how it was given (portal checkbox, written consent, form) before any
  WhatsApp message is sent to that contact.
- A contact who leaves the company is marked `left`: portal access is revoked, history is kept.

## Activity timeline

- Every client, contact, deal, project and ticket has a timeline built from `activities`.
- System events are written automatically:
  - status changes
  - document sent, viewed, signed
  - invoice sent, viewed, paid
  - email and WhatsApp sent
  - ticket events
- Team members add notes, calls and meetings manually. Notes support @mentions, which notify the mentioned member.

## Rate card

- Items with a unit (fixed, hour, day, week, month) and a price per currency.
- Adding a rate card item to a quote or invoice fills in description, unit price for the document's currency, and
  taxable flag; the user can override the price on that document.
- If an item has no price in the document's currency, the user must enter one; never convert automatically.
- Inactive items stay on existing documents but cannot be added to new ones.

## Calendar

- Each team member can connect Google Calendar through OAuth (tokens encrypted in `integrations`).
- Creating a meeting from a deal, client or project creates a Google Calendar event with a Meet link when the organiser is
  connected, invites the attendees, and stores the event id.
- A booking page per team member at `os.unbuilt.studio/book/[member]` shows free slots from their calendar within
  business hours. Booking from it creates a meeting, and a lead and contact if the email is new.
- Updates and cancellations in the OS sync to Google. Changes made in Google Calendar are not synced back.

## Intake forms

- Form builder: text, long text, single choice, multiple choice, date, file upload, URL.
- Intake forms can be attached to project templates. When a project is created from the template, the form is sent to
  the client's primary contact through the portal.
- Responses attach to the client and project and are visible on the project overview.

## Decisions and rules (studio, 2026-09-14)

- **Won** needs a project: moving a deal to Won asks whether to create one (blank or from a template, starting from the
  deal's title, currency and value) or to link an open project of the same client that no other deal has won. Creating
  one needs `projects.create`; linking one needs `deals.manage`.
- **Deleting a client** (`clients.delete`) works only while nothing depends on it: no contact has signed in to the
  portal, and no deals, projects, invoices or documents (each module adds its check). Otherwise the client is archived.
  Archived clients are hidden from the list unless filtered for. Contacts who never signed in can also be deleted;
  others are marked left.
- **A country is chosen, not typed** (studio, 2026-09-27): a two-letter code typed by hand is a guess, and `SP` looks
  like Spain while being no country at all — nothing would have said so. The stored value is still the code; the list
  and the names come from `Intl`, so there is no table of translations to drift. A code is shown as its name, and one
  that is not a country is shown exactly as it was stored rather than as "Unknown Region", so a person can see the
  mistake and fix it.
- **The figures on a client are asked for per permission**: somebody without `invoices.view` never sends the query,
  and the card says the figure is not theirs to see rather than showing a blank. Money is totalled per currency and
  shown side by side, never converted into one number.
- **Billing details** (legal name, address, TIN, VAT treatment, WHT, default currency, payment terms) are edited with
  `invoices.update`: the Owner, Admins and Finance. Project managers edit the rest of the client and see billing details
  read-only.
- **Timeline**: anyone with `clients.view` adds notes, calls and meetings to a client or its contacts (up to a year
  before or after today). Authors edit and delete their own; the Owner and Admins (`clients.delete`) can delete anyone's
  but not edit them. Automatic entries cannot be edited or deleted. A client's timeline includes its contacts' entries.
  Mentions are stored as `@[Name](member:ID)` and notify active members other than the author, including members newly
  mentioned when a note is edited.
- **Enquiry IP address and browser** are shown only to `audit.view` holders (the Owner and Admins).
- **Portal access**: an address can have portal access at one client only and never when it belongs to a team member
  who is not offboarded. A contact's email cannot change while they have portal access or have signed in. Giving the
  first portal access at a client turns the client portal on. Turning a client's portal off, revoking access or marking
  a contact as left signs them out at once.
- **WhatsApp opt-in** records how and by whom consent was given. Changing the contact's WhatsApp number or marking them
  as left withdraws it.
- The client list search matches any part of the display or legal name.
- The acknowledgement email to people who send an enquiry is built with the communications step; until then new
  enquiries notify the team in-app only.
- **Pipeline stages and lost reasons** are changed with `deals.manage` (Owner, Admins and project managers) and read
  with `deals.view`. Only open stages are added, reordered or removed; removing one with deals moves them to another
  open stage first. Won stays at 100% and Lost at 0%, and both can be renamed. Retired lost reasons stay on deals
  already lost with them. Changing a stage's probability does not change existing deals.
- **Moving a deal** to an open stage sets that stage's probability. Lost needs an active reason; the note is optional.
  Moving a lost deal back to an open stage clears the loss. A won deal stays won. Deleting a deal is `clients.delete`;
  an enquiry converted into it returns to reviewed.
- **Follow-up reminders** run daily at 17:00 in Lagos. A follow-up is missed when its date has arrived and nothing was
  logged on the deal on or after that date; the owner is told once per date. A deal is idle 7 days after its last
  timeline entry (creation counts) with no follow-up date today or later; the owner is told once until new activity. A
  missed follow-up is reported instead of idleness on the same day. Timeline entries logged for a past date count from
  that date.
- **Pipeline value** is shown per currency. Conversion to NGN for display waits for FX rates in the billing step.
- **The enquiry endpoint** checks, in order: an allowed origin (`ENQUIRY_ALLOWED_ORIGINS`), a JSON body up to 20 KB
  matching the form, Turnstile (refused when `TURNSTILE_SECRET_KEY` is missing), then 5 per hour per IP and 3 per day
  per email. It responds `{ ok: true }`, or `{ ok: false, error }` with 403, 400, 413, 503 or 429. Only enquiries that
  pass Turnstile count toward the limits; a request refused for its email still uses one of its IP's.
- **Converting** matches a client by a contact with the same email, then a client website or contact on the same email
  domain (never a free provider such as gmail.com), then a client whose name equals the company. The person converting
  confirms or chooses another client, or creates one. The contact is the client's active contact with that email or a
  new one, and the deal starts in the first open stage with the enquiry's services. Converting needs
  `enquiries.manage`, `deals.manage`, and `clients.create` or `contacts.manage` for records it creates.
- **Manual enquiries** (email, referral, in person) start as reviewed and notify the other `enquiries.manage` holders.

## Screens

- `/crm/clients` (`clients.view`): search on display or legal name, filters for status (archived only when chosen), tag
  and industry, and "New client" (`clients.create`), which opens the new client.
- `/crm/clients/[id]` has a header (status, legal name, industry, owner, Edit with `clients.update`) and tabs. Tabs for
  modules not built yet (deals until the sales screens, projects, documents, invoices, tickets, vault, assets, files)
  stay visible but inert; Vault shows only with a vault permission.
  - **Overview**: open deals (`deals.view`) totalled per currency, placeholders for billed, outstanding, projects and
    tickets, the latest five timeline entries, details, and a status change with a reason (`clients.update`).
  - **Contacts**: cards with primary, billing, WhatsApp opt-in and portal status. With `contacts.manage`: add and edit,
    make primary, give portal access (automatic or chosen role), change the portal role, resend the invite, remove
    access, record or withdraw WhatsApp opt-in with its method, mark as left or as a contact again, and delete someone
    who never signed in. The email cannot be edited while they have portal access or have signed in.
  - **Activity**: the full timeline with a composer for notes, calls (with a time) and meetings. "Mention someone"
    inserts `@Name`; the name becomes mention markup when saved, and removing it from the text drops the mention.
  - **Settings**: billing details (editable with `invoices.update`, read-only otherwise), SLA policy
    (`clients.update`), the client portal switch (`contacts.manage`; turning it off asks first), archive or restore
    (`clients.update`) and delete (`clients.delete`).
- `/crm/enquiries` (`enquiries.view`): Open (new and reviewed), Converted, Spam and Closed, newest first, each showing
  its services, budget, source and any existing client with that email. "Add enquiry" (`enquiries.manage`) records one
  that came by email, referral or in person.
- `/crm/enquiries/[id]`: the answers with labels, the sender's IP and browser when the query returns them (`audit.view`),
  contacts already using the email with their open deals, and links to the client and deal once converted. Opening a
  new enquiry marks it reviewed for `enquiries.manage` holders. Actions: Convert (with `deals.manage`), Close, Mark as
  spam, Reopen. Convert preselects the suggested client (with the reason) or a new client named after the company,
  and asks for the deal title and an estimated value; it opens the new deal.
- `/crm/deals` (`deals.view`): pipeline value and weighted value per currency, Board and Table views, and an Everyone or
  My deals filter. On the board, `deals.manage` holders drag cards between stages or use each card's stage menu. Won
  asks which project the deal becomes; Lost asks for a reason and an optional note. Cards show the owner and the next
  follow-up. Won and Lost columns show deals closed in the last 90 days. "New deal" chooses the client.
- `/crm/deals/[id]`: value, probability and stage (movable with `deals.manage`), the project a won deal became (named
  but not linked for someone off the project), the loss reason when lost, next
  follow-up (set or clear), details with links to the client and the enquiry, the deal's timeline, Edit
  (`deals.manage`) and Delete (`clients.delete`).
- The client page's **Deals** tab (`deals.view`) lists the client's open, won, lost or all deals, with "New deal" for
  that client.
- The client page's **Projects** tab (`projects.view.all` or `projects.view.assigned`) lists the client's projects in
  the viewer's scope, with "New project" for that client (`projects.create`).
- `/settings/pipeline` (`deals.manage`): rename stages and set open stages' win percentage, move open stages up and
  down, add stages, remove a stage (choosing where its deals go), and add, rename, reorder, retire or bring back lost
  reasons.
- `/crm/rate-card` (`ratecard.view`, in the CRM menu): items with unit, category, VAT and a price column per currency;
  add, edit, retire and bring back with `ratecard.manage`. Retired items are hidden unless shown.

## Acceptance criteria

- A website enquiry with a valid Turnstile token appears in the inbox and notifies `enquiries.manage` holders; an
  invalid token or a rate-limited request is rejected without creating a row.
- Converting an enquiry from an existing contact's email links to that client instead of creating a duplicate.
- Moving a deal to Won creates or links its project in the same step; moving to Lost without a reason is blocked.
- A deal idle for 7 days with no future follow-up notifies its owner exactly once per idle period.
- Weighted pipeline value equals the sum of value × probability, verified by test.
- A rate card item lacking a price in the document currency cannot be added without a manual price.
- A WhatsApp message to a contact without recorded opt-in is never sent.
- Contacts marked `left` lose portal access immediately.
