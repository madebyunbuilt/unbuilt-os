# 12 — Client portal

`portal.unbuilt.studio`. Everything here uses `portalQuery` and `portalMutation`, filtered to the signed-in contact's
client (see `03-auth-and-permissions.md`).

## Navigation

1. **Home**:
   - what needs the client's attention (documents to sign, deliverables to review, change requests to approve, invoices
     due, intake forms to fill in)
   - active projects with the next milestone
   - the latest update
2. **Projects**, each with:
   - milestones and progress
   - deliverables with versions, approve or request changes, and comments
   - change requests, to approve or decline
   - weekly updates
   - shared files
   - tickets
3. **Documents**: everything sent to the client, by type and status. View online, download PDF, sign, accept or decline
   quotes and proposals, see the document chain and signed certificates.
4. **Invoices**:
   - open and paid invoices
   - pay with Paystack
   - bank transfer details for unsupported currencies
   - receipts and credit notes
   - statement of account for any date range
5. **Support**:
   - raise a ticket (priority with plain-language descriptions)
   - view tickets and reply
   - SLA report history
   - retainer hours balance
6. **Access**: submit credentials securely (encrypted on submit), and see labels and dates of what they submitted.
7. **Forms**: intake forms to complete.
8. **Team** (client admin): invite and remove colleagues, set Client admin or Client member, manage WhatsApp and email
   notification preferences for themselves.

## Rules

- **Only client-visible data**: internal comments, internal ticket notes, cost figures, budgets, profit, time entry
  descriptions and team rates never appear. Time is shown only as retainer totals.
- **Client admin vs member**: see the client roles table in `03-auth-and-permissions.md`. Invoices and approving change
  requests are admin-only by default; this is configurable per client.
- **A client decides through the same code the studio uses** (studio, 2026-09-25): approving a deliverable calls
  `applyClientDecision`, and deciding a change request calls `applyDecision`, so an approval from the portal closes its
  milestone and moves the project's budget exactly as one recorded by the studio does. One rule rather than two that
  could drift. The contact is the actor either way.
- **Asking for changes says what needs changing** (studio, 2026-09-25): the note is required, goes to the project's
  manager and whoever submitted the version, and is written to the client's timeline rather than living only in a
  notification somebody may clear. An approval tells them too (`14-platform.md`, Deliverable approved / changes
  requested). Full comments on a deliverable, which let the studio reply, come with the comments work.
- **The client opens what was submitted**: the files on a version are theirs to read, which is the portal rule on
  deliverables that the earlier steps deferred to this one.
- **A change above the signature threshold is not approved from the portal**: the button is absent and the page points
  at the signing link in their email. Declining never needs a signature.
- **Retainer hours are shown as hours, and nothing beside them is priced**: no fee, no overage rate, no time entry and
  no description. A deliverable the studio has not sent a version of does not appear at all.
- **A client is never told their debt was written off** (studio, 2026-09-24): a written-off invoice is absent from the
  portal entirely, the same way it is absent from a statement. Drafts are absent too, being the studio's own working
  copies.
- **Paying from the portal opens the same pay page an emailed link opens.** The token is derived from the invoice, so
  the portal works it out rather than minting a second one, and a client who arrives from their inbox or from the
  portal lands in the same place. An invoice whose token predates that rule is offered no link at all, rather than one
  that would not open; the bank details are always shown either way.
- **The reference shown to a client is Paystack's**, never `inv_<invoiceId>_<attempt>`, which is the studio's own.
- **A paid invoice still downloads as the invoice that was sent** (studio, 2026-09-24), with no "paid" stamp added: it
  is a fixed document, and re-rendering it would hand the client a different file under the same number, no longer
  matching its stored hash. The page says it was settled and points at the receipt, which is the proof of payment.
  Receipts and credit notes download from the invoice they belong to.
- **A signed document says where it actually stands** (studio, 2026-09-24): `awaiting_signature` is set the moment the
  document is sent, so it means only that it went out. What the client is told comes from the signing request instead —
  needs your signature when they are the one invited, your turn is coming when somebody signs first, waiting for
  signatures when it is with a colleague, and sent to you when nobody has been asked yet. A client is never promised an
  email that is not coming.
- **Accepting a quote or proposal follows the signing rule** (studio, 2026-09-24): a client admin always, and a client
  member only where the studio addressed the document to them, since accepting commits the client to a price. Documents
  therefore record `recipientContactIds` when they are sent, the way invoices do; without it there is no way to know
  who the studio named.
- **A client is never left with nobody who can act** (studio, 2026-09-25): approving work and paying invoices are the
  admin's, so a client with no admin can read and do nothing, and cannot even put itself right without asking the
  studio. Any change that would remove the last active admin — stepping down, being demoted, or having access
  removed — is refused. An admin can hand the job over: once a second admin exists they may step down, and the page
  stops being theirs, which is the point of handing it over. Nobody removes their own access.
- **Inviting a colleague reuses the contact the studio already holds** (studio, 2026-09-25): an address the studio has
  on file at that client is given access rather than added a second time, so the portal never splits one person into
  two records. A client admin can also invite somebody the studio has never met, and the contact is created here. One
  portal sign-in per address still holds, and a team member's address is refused.
- **Access is taken away, not the person**: revoking clears `portalAccess` and the portal role and leaves the contact,
  because the studio still needs to know who it was dealing with and what they approved.
- **Notifications** to clients honour their preferences, except legally required notices (for example signed copies)
  which always go by email. Client-side notification preferences (`Team`, above) are part of the notifications work,
  not of the colleagues screen.
- **Branding**: Unbuilt branding. The client's name appears in the header.
- **First sign-in** shows a short walkthrough and asks for WhatsApp opt-in with a clear explanation of what will be sent.
- **Portal privacy notice** and terms, served from the CMS legal pages, linked in the footer and accepted on first sign-in
  (acceptance recorded with version and time). **Built in step 14, not step 10** (studio, 2026-09-25): the notice and
  terms are CMS legal pages, so until the CMS exists there is nothing for a client to read. Asking somebody to accept
  an empty page records a consent that is worth nothing, which matters more here than elsewhere because this consent is
  the one `15-security-and-compliance.md` relies on. Until then the portal asks for no acceptance at all rather than
  showing a placeholder.

## Public token pages

Contacts without portal access can still act through token links, with no account:

- `/sign/[token]` for signing.
- `/pay/[token]` for viewing and paying one invoice.

Token pages show only the one document or invoice.

## Acceptance criteria

- A client user never receives data belonging to another client, verified by tests for every portal function with two
  clients.
- Internal comments, internal notes, costs, budgets and rates are absent from every portal response.
- A Client member cannot pay invoices or approve change requests unless the client's settings allow it.
- A client admin can invite a colleague, who receives a magic link and the chosen role.
- Credential submissions from the portal are encrypted before storage and cannot be read back in plaintext.
- First sign-in records acceptance of the current portal terms version (step 14, once the legal pages exist).
- Token pages expose only their single document or invoice and stop working when the token is revoked or expired.
