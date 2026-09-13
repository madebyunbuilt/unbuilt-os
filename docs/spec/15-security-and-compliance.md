# 15 — Security and compliance

Not legal advice. The rules below describe what the system must support; the studio's lawyer and accountant confirm the
policies (see `18-open-questions.md`).

## Security baseline

- **Authentication**: see `03-auth-and-permissions.md`. Mandatory 2FA for the team, magic links with email codes for
  clients, session limits, invitation-only accounts.
- **Authorisation**: every function through the wrappers; record-level scope; sensitive field serializers; tests for
  every exported function.
- **Secrets**:
  - API keys and tokens in Convex environment variables and Vercel encrypted env vars, never in the database except
    OAuth tokens, which are encrypted with the vault crypto.
  - Separate keys per environment.
  - Live keys only in production.
- **Vault**: `10-vault.md`.
- **Rate limiting** (`@convex-dev/rate-limiter`):
  - magic link and email code requests (per email and per IP)
  - code verification attempts (5 then lockout for 15 minutes)
  - public endpoints
  - webhook routes
  - vault reveals (per member)
  - exports
- **Tokens** (signing, paying, preview): random 32 bytes, only SHA-256 hashes stored, single purpose, expiring, revocable.
- **Files**: permission-checked, short-lived download URLs; MIME type and size validated on upload; SHA-256 stored.
- **Headers**: strict CSP with nonces, `frame-ancestors 'none'`, HSTS, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` minimal.
- **Dependencies**: Dependabot for npm and GitHub Actions; CI fails on high-severity advisories in production dependencies.
- **Logging**: no personal data or secrets in logs beyond ids; Sentry scrubs request bodies and headers.
- **Audit**: append-only audit log for writes and sensitive reads.

## Backups and recovery

- Daily automated backup of the production deployment using Convex's backup feature where the plan provides it, plus a
  weekly `pnpm convex export` to encrypted off-platform storage kept for 90 days.
- A documented restore procedure in `docs/runbooks/restore.md`, tested at launch and every quarter against a scratch
  deployment. Record each test in the audit log.
- File storage is included in exports.

## Data protection (NDPA 2023, and GDPR for EU and UK data subjects)

### Roles

- For its own clients' and contacts' data, the studio is the **controller**.
- For personal data inside client products that the team can access (for example production databases through vault
  credentials), the studio is a **processor** under a DPA with the client. The DPA document type supports this.

### Personal data inventory

Document in `docs/privacy/inventory.md`:
- contacts
- team members
- enquiries
- messages
- signatures (including IP addresses)
- time and location-free activity
- files
- vault contents

For each: lawful basis, retention and processors (Convex, Vercel, Resend, Meta, Paystack, Google, Sentry, Cloudflare).

### Data location

- Convex, Vercel, Resend and Sentry process data outside Nigeria. Choose the Convex deployment region deliberately (see
  open questions).
- The privacy notice names each processor and the transfer safeguards.

### Privacy requests

`privacy.requests.manage`:
- Log requests (access, correction, deletion, restriction) with a due date (default 30 days; confirm the statutory period
  with counsel).
- **Access**: generate a JSON and PDF export of everything linked to the subject's email across contacts, enquiries,
  messages, tickets, comments, signatures and files.
- **Correction**: edit with audit.
- **Deletion**: anonymise personal fields on records that must be kept for legal reasons (invoices, signed documents,
  payments, audit entries keep the record but replace the person's name and contact details with a pseudonym where the
  law allows); delete everything else. Show the plan before executing. Legal holds block deletion.
- Every step is audited.

### Retention

Defaults, configurable, to be confirmed:

| Data                                           | Default retention                                   |
| ---------------------------------------------- | --------------------------------------------------- |
| Enquiries that never became clients            | 2 years after last activity                         |
| Clients, projects, documents, invoices, payments | Engagement plus 7 years (tax and accounting)      |
| Signed documents and signature evidence        | Engagement plus 7 years, or longer for contracts under legal hold |
| Vault items                                    | Deleted 30 days after handover archive              |
| Monitor checks                                 | 90 days                                             |
| Message logs                                   | 2 years                                             |
| Audit log                                      | 7 years                                             |
| Offboarded team member personal data           | 7 years for employment records, otherwise 2 years   |

A monthly cron lists records past retention for an admin to approve deletion in bulk.

### Consent and notices

- WhatsApp opt-in recorded per contact and member.
- Portal privacy notice and terms accepted with version and time.
- The public website's privacy page is updated before launch to describe enquiries flowing into the OS and the processors
  involved.

## Acceptance criteria

- Security headers are present on every response, verified by an automated check in CI.
- Rate limits trigger on magic link, code verification, public endpoints and vault reveals.
- A restore from backup to a scratch deployment succeeds and is recorded before launch.
- An access request export includes records from every table that holds the subject's email.
- A deletion request anonymises retained financial records and removes the rest, and cannot run on a record under legal hold.
- No secret or plaintext credential appears in logs, Sentry events, audit diffs or exports.
