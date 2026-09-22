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

Nigeria's Evidence Act 2011 recognises electronic signatures, but this spec does not replace legal advice. Settings →
Document templates shows "The signing process", which stays off until the Owner records that the studio's lawyer
confirmed the process; templates carry their own approval. See `18-open-questions.md`.

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
- **Sending** is checked in a mutation (`documents.send`, which refuses a signed or void document and a client with no
  contact to send to) and carried out by a scheduled Node action: snapshot the version, render the PDF, store it with its
  hash, assign the number on the first send, email the recipients, then mark it sent. The document keeps the status it
  had until the email is away, and whoever pressed send is notified if any step fails.
- **Recipients** default to the client's primary contact; the sender can choose others, and a contact who has left is
  never one. Every send records the recipients on the client's timeline.
- **A document needs a template.** Creating one for a type with no active template is refused rather than producing a
  document with no wording. `refreshText` only applies to a document made from a template; one written by hand is edited
  in place.
- **A send that failed** is retried into the same version: the version row an unfinished attempt left behind is filled
  in again rather than another being stacked on top. The number, once assigned, never changes.
- **react-pdf is an external package** (`convex.json`), because its pdfkit dependency resolves `#standard-fonts/*`
  subpath imports at runtime that the bundler cannot follow. External packages arrive as CommonJS, so the renderer takes
  the named export first.
- **The PDF** renders the same bytes for the same version, so its hash is stable; a signature certificate can rely on
  it. Its file belongs to the document, is marked client-visible, and is read through the usual signed download link:
  every document reader may fetch it, and a member with `documents.view.assigned` only within their projects.
- **View tracking**: a team member's look is recorded as `member` and never counts as the client's. A client's first
  look moves a sent document to viewed, sets `firstViewedAt` and notifies whoever drafted it, once; later looks only
  raise the count, and a document already accepted or signed keeps that status.
- **The lawyer's approval** (studio, 2026-09-22) is recorded per template, against the exact version the lawyer read,
  and only by the Owner. Editing the template makes a new version, which shows as needing review again until it too is
  approved. An approval must name the version on screen, so it cannot land on wording changed while the Owner was
  reading. New documents warn only while the wording still waits for review; nothing blocks sending.
- **The signing process review** is a studio setting, off until the Owner records that counsel reviewed it (the emailed
  code, the consent statement, the evidence recorded and the certificate), and can be withdrawn. Anyone may see it.
- **Variables** are limited to fields the app actually holds, so a document can never print a blank where a value was
  promised. The studio's email, phone and website are part of that set: they are settings, checked the same way a
  contact's are (a real address, an international number, a resolvable site), and they belong on a letterhead.
- **Nothing goes out with a blank** (studio, 2026-09-22). A document whose wording uses a variable the app has no value
  for cannot be sent: the send is refused in the mutation and again in the send action, and the document page lists
  each missing detail with where to fill it in (Settings → Organisation, the client's page, the project, the draft).
  The Send button stays off until the list is empty. A sent document can take a corrected version while it is with the client, expired, or waiting
  to be signed, since sending moves the signed types straight to waiting. Only a draft shows a dash in place of a missing value, and only
  the number, assigned on first send, is exempt.
- **The payment schedule** is written on the draft, as a line of words ("50% on signature, 50% on completion"), and
  fills `{{schedule.summary}}`. The draft asks for it only when its wording prints it, and a document drafted from
  another carries it across. Billing schedules will fill it once they exist.

## E-signature decisions (studio, 2026-09-22)

- **The code** works for 10 minutes. Five wrong tries lock the link, counted across every code the signer asks for, so
  asking for new codes buys no extra guesses. A locked link opens again only when the studio sends a new one, which the
  timeline records; whoever set up the request is notified of the lock. A signer may ask for 5 codes an hour, and one
  address for 20. After the code is checked the signer has 30 minutes to sign or decline; declining needs the same
  check, so a forwarded link cannot turn a document down.
- **The studio countersigns inside the app**, not through an emailed link, typing a name or drawing, as a client can. The member's two-factor sign-in stands in
  for the emailed code, and the signature records when that sign-in happened (`verification: app_session`).
- **Which documents**: quotes and proposals are accepted, not signed. Every other type can have a request: the signed
  types by default, an SLA or change request when the studio chooses to. A request needs a sent document (a version, a
  stored PDF and its hash), at least one active contact at the document's client, and a countersigner, if any, who is an
  active member holding `documents.countersign`. The studio signs last, in either order: in parallel every client is invited at once, and the countersigner once they have all signed. Only one request per document is open at a time,
  and while it is, the document cannot be re-sent, since a new version would not match what is being signed. Voiding
  the document cancels the request.
- **Links**: the token is minted inside the action that emails it, so it never passes through stored scheduler
  arguments; only its hash is stored, in `signingLinks`, which finds a signer without scanning every request. Sending a
  signer a link (a resend or a reminder) replaces their earlier one, and the email says so. If the deployment cannot send
  email the old link is left working, and whoever set up the request is told the link did not go out. A link outlives
  its request so the signer can see what happened, but the document is shown only while it is still theirs to sign.
  Opening it records a client view (`viewerKind: token`).
- **Public endpoints**: the `/sign/[token]` page calls `POST /public/sign/{view,code,verify,upload,sign,decline}` on the
  Convex site, with the token in the body so it stays out of URLs and logs. Only the app's own hosts may call them. A
  drawn signature is uploaded as a PNG only after the code is checked; it belongs to the request and only
  `documents.view` holders may fetch it on its own.
- **Closing unsigned**: a decline (with its reason) sets the document to declined and notifies whoever set up the
  request. A cancel (with a reason) or an expiry returns it to where sending left it: awaiting signature for the signed
  types, sent otherwise, ready for a new request. Requests expire hourly; a link is refused the moment its date passes,
  whether or not the job has run. Reminders go out daily at 09:00 Lagos, at most one per signer per day.
- **Completion** runs in a Node action. It loads the stored PDF and refuses to go on unless its hash still matches the
  one the request locked. The signed copy carries the signatures on the document's own lines (studio, 2026-09-22): each
  side's names on the Name line, the drawn or typed signatures and the date on the signature line. To do that the
  document is drawn again from the payload kept with its version at send; drawn without signatures it must reproduce
  the locked hash exactly, and only then is it drawn with them, in the space above each line so nothing moves. A version
  sent before the payload was kept, or before the renderer changed, keeps its pages as they are. Either way the
  certificate (rendered on its own) is appended with pdf-lib, says whether the signatures are also on the lines, and
  records the hash of the document as signed. The stored original is never changed. The signed PDF is stored on the
  document, client-visible, with its own hash, which storage's own hash must agree with. Every signer is emailed a copy.
  If any step fails, the signatures stay recorded, the reason is kept on the request, whoever set it up is told, and
  `documents.send` holders can run it again. The downstream actions (billing `on_signature` items, project status)
  arrive with billing.
- **The PDF footer** ("page x of y") is anchored from the top of the A4 page: with a line height on the page, react-pdf
  drops a footer placed from the bottom.
- **Verify** (anyone who can read the document) recomputes the hashes of the stored original and the signed PDF in an
  action and records the result on the request; a mismatch notifies the asker and the Owner.
- **Typed signatures** are drawn in Dancing Script (SIL Open Font License, embedded in the PDF and shown the same on
  the signing screens), so a typed name reads as signed beside a drawn one; the certificate still says "Typed name".
  Uploading an image of a signature was considered and left out: it proves no more than drawing, and would mean holding
  scans of people's real signatures.
- **Evidence** is written once: nothing patches or deletes a `signatures` row. Audit entries for requests and links
  redact the signers and token hashes, since a six-digit code is quick to recover from its hash.

## Screens

- `/documents` (`documents.view` or `documents.view.assigned`): every document the viewer can see, newest first, with
  filters for type and status, and its number, client, status, total and valid-until date. "New document"
  (`documents.create`) chooses the type, client, template, currency, an optional title and, for priced types, the lines
  with a running total; rate card items fill a line's description and price where the item is priced in that currency.
  A template still awaiting legal review says so before anything is created.
- The document page shows the document as the client will read it, its chain, and its versions. Looking at it records a
  team view, which never counts as the client's.
  - `documents.send`: send it (the main contact ticked, others addable, an optional note, and a change note on later
    versions), then record what the client said (accepted or declined, with who said so).
  - `documents.update`: edit the draft — title, valid-until, the priced lines, and the wording block by block, or
    rebuild the wording from the template with today's client and project details.
  - `documents.void`: void it with a reason. Never offered on a signed document.
  - `documents.create`: draft the next document in the chain (quote → proposal → SOW → contract), which carries the
    client, project, deal and prices across.
  - Anyone who can read it can download the stored PDF through a short-lived link.
- **Settings → Document templates** (`templates.documents.manage`): templates grouped by type, with the default and
  the legal-review flag shown; make another the default, retire or bring one back, and open one to edit. The editor
  builds a template from blocks — add, reorder and remove them, type into headings and paragraphs, and pick a clause by
  key — and lists every variable a template may use, so nothing has to be guessed. Saving a change makes a new
  version; the server's reason is shown when it refuses one.
- **Settings → Clauses** (`templates.documents.manage`): clauses grouped by category; add one, reword it (which makes
  the next version), retire or bring it back. A clause an active template uses cannot be retired, and the page says
  which templates are holding it.
- **Signatures** on the document page, for every type but quotes and proposals once it has been sent: the current
  request with each signer's status (waiting, invited, signed, declined, locked), when they opened and signed, and any
  reason given; earlier requests folded away below.
  - `documents.send`: "Send for signature" (client contacts, the primary ticked; a countersigner from the members who
    may countersign; the order; how many days it stays open), off while details are missing. Send a signer a new link,
    which is also how a locked link is unlocked. Cancel the request with a reason. Run completion again after a failure.
    While a request is open, "Send the next version" is not offered.
  - `documents.countersign`: "Countersign" appears only to the member named on the request, once it is their turn: a
    typed name and the consent statement.
  - Anyone who can read it: download the signed PDF, see its fingerprint, and Verify, with the last result shown.
- **`/sign/[token]`**, on either host without a session: the document in full with its PDF, then "Email me a code" and
  the six boxes; a wrong code says how many tries are left, and the lock says to ask the studio. Then type a name or
  draw a signature, tick the consent statement, and Sign; or decline with a reason. A link whose request has closed, or
  whose signer has signed, is locked or not yet due, says so in plain words and shows no document. The page sends no
  referrer and is not indexed, since the token is in its address.
- The client page's and the project's **Documents** tabs list that client's or project's documents, and can start one
  already pointed at them.

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
