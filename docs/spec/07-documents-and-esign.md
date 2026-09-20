# 07 — Documents and e-signatures

## Document types

| Type           | Purpose                                                    |  Priced  |          Signed by default          |
| -------------- | ---------------------------------------------------------- | :------: | :---------------------------------: |
| Quote          | Price for defined work, valid until a date                 |   Yes    |       No, accepted in portal        |
| Proposal       | Approach, scope, timeline and price                        |   Yes    |       No, accepted in portal        |
| SOW            | Detailed scope, deliverables, milestones, acceptance terms |   Yes    |                 Yes                 |
| Contract       | Master services agreement: terms, IP, liability, payment   |    No    |                 Yes                 |
| SLA            | Support targets, hours, uptime, remedies                   | Optional |                 Yes                 |
| NDA            | Confidentiality                                            |    No    |                 Yes                 |
| DPA            | Data processing agreement for client personal data         |    No    |                 Yes                 |
| Change request | Priced change to scope                                     |   Yes    | By threshold (see `06-projects.md`) |
| Handover       | What was delivered and transferred                         |    No    |                 Yes                 |
| Team agreement | Contractor agreement, NDA or employment contract for team  |    No    |                 Yes                 |

## Templates and clauses

- Templates are ordered **blocks**:
  - heading
  - paragraph (rich text with variables)
  - clause (reference to a clause by key and version)
  - line items table
  - totals
  - milestones table
  - payment schedule
  - signature block
  - page break
  - image
- **Variables** use `{{path}}` against a fixed context:
  - `client.*` `contact.*` `project.*` `deal.*` `org.*` `document.*`
  - `today` `validUntil` `totals.*` `schedule.*`
  - Unknown variables fail validation when saving the template.
- **Clauses** are versioned. A document snapshots the clause text at creation, so editing a clause never changes sent or
  signed documents.
- Editing a template creates a new template version; existing documents keep theirs.
- Seed templates for every type, written in plain language. Contract, NDA, DPA and team agreement templates are marked
  "Requires legal review" in the UI until a setting records the lawyer's approval.
- Seeding adds a clause by its key and a template by its name, so a studio that has edited either keeps its wording
  when the seed runs again.
- A template of a priced type is refused without a totals block, so a price can never be sent without its total.
- A clause an active template still names cannot be retired; templates and clauses are retired, never deleted.
- Editing a clause's wording raises its version; editing only its title or category leaves the version alone.

## The document chain

- A document can be created from another: quote → proposal → SOW → contract, and SOW → billing schedule.
- Creating from a parent copies client, project, deal, line items, milestones and relevant variables, and sets
  `parentDocumentId` and `chainRootId`.
- The document page shows the whole chain with each document's status.
- Accepting a proposal or SOW can create the project (if the deal has none) and the billing schedule in one step.

## Lifecycle

`draft → sent → viewed → accepted | declined | expired`, or for signed types
`draft → sent → awaiting_signature → partially_signed → signed`, and `void` from any state before signed.

- **Send**:
  1. Resolve variables.
  2. Snapshot blocks, line items and totals into a new `documentVersions` row.
  3. Render the PDF.
  4. Store it with its SHA-256.
  5. Assign the number if this is the first send.
  6. Email the client (and WhatsApp, by preference) with a portal link.
- **Editing a sent document** creates a new version and re-sends. The previous version stays viewable, marked superseded.
  A signed document cannot be edited; changes require a new document (typically a change request or amendment).
- **Expiry**: quotes and proposals have `validUntilDate` (default from settings). A daily cron marks expired ones and
  notifies the owner. Expired documents can be re-issued as a new version with a new date.
- **Void**: requires a reason, keeps the number, and is watermarked "Void" on the PDF.

## View tracking

- Every portal or token view writes `documentViews` with version, viewer, IP and user agent.
- The first view sets `firstViewedAt`, moves `sent` to `viewed`, and notifies the document owner.
- Team views are not counted as client views.

## PDF rendering

- React-pdf templates in `pdf/`, rendered in a Node action. Branding per `01-product.md`.
- Every page: mark and document number in the header, page x of y in the footer.
- Priced documents use the same totals function as invoices (`convex/lib/money.ts`).
- Rendering is deterministic for the same version so the hash is stable.

## E-signatures

### Setting up a request

- Choose signers:
  - one or more client contacts
  - optionally a team countersigner with `documents.countersign`
- Choose the order: sequential (default: client first, studio countersigns last) or parallel.
- Set an expiry (default 14 days).
- Creating the request locks the current version and stores its PDF hash.

### The signing ceremony

Each signer gets an email (and WhatsApp by preference) with a unique link `/sign/[token]`. Only the token's hash is
stored. The signer then:

1. Opens the link and sees the full document rendered from the locked version, with a link to download the PDF.
2. Enters a 6-digit code sent to their email, which verifies they control the address.
3. Reviews the consent statement: "I agree that my electronic signature is the legal equivalent of my handwritten
   signature on this document." The text is versioned.
4. Types their full name or draws a signature, ticks consent, and clicks Sign.
5. The system writes a `signatures` row with method, typed name or image, consent text and version, IP, user agent,
   code verification time, signing time and the document hash.

- Declining requires a reason and cancels the request; the owner is notified.
- Reminders go to pending signers after 3 and 7 days, and a final reminder a day before expiry.
- In sequential order, the next signer is invited only when the previous one signs.

### Completion

- When all signers have signed:
  1. Generate the final PDF: the locked version plus a **signature certificate** page listing each signer, method,
     signature image or typed name, email, code verification time, signing time, IP, and the SHA-256 of the signed
     document.
  2. Store the final PDF with its own hash.
  3. Set the document to `signed`.
  4. Email every signer a copy.
  5. Trigger downstream actions: billing schedule `on_signature` items, and the project status.
- **Tamper check**: a "Verify" action recomputes the hash of the stored PDF and compares it with the stored value.

### Legal note

Nigeria's Evidence Act 2011 recognises electronic signatures, but this spec does not replace legal advice. Show a
settings toggle "Signature process reviewed by counsel" that stays off until the studio's lawyer confirms the process
and templates. See `18-open-questions.md`.

## Decisions and rules (studio, 2026-09-21)

- **Who sees a document**: `documents.view` reaches every document; `documents.view.assigned` reaches the ones on a
  project the member belongs to. Anything else is "not found", as elsewhere.
- **A document owns its text.** Creating it copies each clause's current wording in and fills every variable, so later
  edits to the template or the clause change nothing. `refreshText` re-reads client, project and totals into a draft
  on request; it never brings in new clause or template wording.
- **Prices** come from the client's own VAT treatment and WHT settings, with the studio's default VAT rate, and can be
  overridden per document. Only quotes, proposals, SOWs and change requests carry prices.
- **Accepting and declining**: until the client portal exists, `documents.send` holders record the decision the client
  gave elsewhere. The document keeps who recorded it and the note, so a recorded acceptance is never mistaken for one
  the client clicked. A decline needs a reason. Only a document with the client (sent or viewed) can be decided.
- **Void** needs a reason, keeps the number, and is refused on a signed document. A draft that was never sent can be
  deleted instead, unless another document was made from it.
- **Expiry** runs daily at 06:00 Lagos and covers quotes and proposals only. Whoever drafted it is notified.
- **Variables** are limited to fields the app actually holds, so a document can never print a blank where a value was
  promised. The studio's email, phone and website are part of that set: they are settings, checked the same way a
  contact's are (a real address, an international number, a resolvable site), and they belong on a letterhead.

## Acceptance criteria

- Sending a document creates an immutable version, a PDF and a stored hash, and assigns a number only on first send.
- Editing a clause or template does not change any existing document.
- A signed document cannot be edited or voided through any function.
- A signing link works only for its signer, only after code verification, and never after expiry, cancellation or signing.
- Sequential signing invites the next signer only after the previous signature.
- The certificate page lists every signer with the evidence fields, and Verify detects any change to the stored PDF.
- Accepting an SOW with a billing schedule creates schedule items; signing a contract fires `on_signature` items exactly once.
- Document views by team members do not mark a document as viewed by the client.
- Quotes past their valid-until date become expired by the daily cron.
