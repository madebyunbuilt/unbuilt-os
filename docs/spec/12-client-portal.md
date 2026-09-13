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
- **Notifications** to clients honour their preferences, except legally required notices (for example signed copies)
  which always go by email.
- **Branding**: Unbuilt branding. The client's name appears in the header.
- **First sign-in** shows a short walkthrough and asks for WhatsApp opt-in with a clear explanation of what will be sent.
- **Portal privacy notice** and terms, served from the CMS legal pages, linked in the footer and accepted on first sign-in
  (acceptance recorded with version and time).

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
- First sign-in records acceptance of the current portal terms version.
- Token pages expose only their single document or invoice and stop working when the token is revoked or expired.
