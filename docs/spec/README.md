# Unbuilt OS — specification

The operating system for Unbuilt Studio: CRM, projects, documents and e-signatures, billing, support and SLAs,
a credentials vault, team management, a client portal, and the CMS that feeds the public website.

Everything described here ships as one product. There are no release phases. `17-build-sequence.md` only orders
the work by dependency.

## How to use this spec

- Read `01-product.md` and `02-architecture.md` before touching any code. They define the decisions that every module
  depends on.
- `03-auth-and-permissions.md` and `04-data-model.md` are shared contracts. Change them first, then the modules.
- Work one module file at a time. Each ends with acceptance criteria; a module is done when every criterion passes
  and has a test.
- When the spec is silent or ambiguous, stop and ask. Do not invent business rules for money, tax, signatures,
  permissions or personal data. `18-open-questions.md` lists what is already known to be unresolved.

## Files

| File                          | Covers                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `01-product.md`               | What the OS is, who uses it, the two surfaces, confirmed decisions, glossary, design       |
| `02-architecture.md`          | Stack, repo layout, environments, CI/CD, conventions, testing                              |
| `03-auth-and-permissions.md`  | Better Auth, team and client identities, permission keys, roles, enforcement, audit        |
| `04-data-model.md`            | Every Convex table, key fields and indexes, money, numbering and time rules                |
| `05-crm.md`                   | Enquiries, pipeline and deals, clients, contacts, rate card, calendar, intake               |
| `06-projects.md`              | Projects, milestones, deliverables, tasks, time, change requests, updates, handover        |
| `07-documents-and-esign.md`   | Templates, the document chain, versions, PDF, view tracking, e-signatures                  |
| `08-billing-and-finance.md`   | Invoices, VAT, WHT, payments, Paystack, schedules, retainers, credit notes, FX, bills       |
| `09-support-and-sla.md`       | Tickets, SLA policies, business hours, retainer hours, uptime monitoring, renewals          |
| `10-vault.md`                 | Encrypted client credentials                                                               |
| `11-team.md`                  | Team members, contractors, rates, time off, capacity                                       |
| `12-client-portal.md`         | Everything a client can see and do                                                          |
| `13-cms-and-website.md`       | Works, service pages, insights, legal, testimonials, settings, publishing, enquiries        |
| `14-platform.md`              | Notifications, email, WhatsApp, search, reports, files, imports and exports, settings, PWA |
| `15-security-and-compliance.md` | Encryption, rate limits, backups, NDPA and GDPR, data requests, retention                 |
| `16-key-flows.md`             | End-to-end flows that cross modules                                                        |
| `17-build-sequence.md`        | Order of work and definition of done                                                       |
| `18-open-questions.md`        | Decisions that need the studio, an accountant or a lawyer                                  |
