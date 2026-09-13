# 01 — Product

## What it is

Unbuilt Studio is a product studio in Nigeria that designs and builds mobile apps and web platforms. Unbuilt OS is the
single system the studio runs on, from the first website enquiry to the final handover, and the source of the public
website's content.

It replaces: spreadsheets of clients, the HTML invoice and quote kit, contracts sent as email attachments, credentials
shared in chat, SLA tracking by memory, and case studies hard-coded in the website repo.

## Who uses it

| User                | Surface | Needs                                                                                  |
| ------------------- | ------- | -------------------------------------------------------------------------------------- |
| Owner and admins    | Team    | Everything, including money, settings, roles and the audit log                         |
| Finance             | Team    | Invoices, payments, WHT, credit notes, bills, expenses, reports                        |
| Project managers    | Team    | Clients, deals, projects, documents, change requests, tickets, client communication    |
| Designers and devs  | Team    | Their assigned projects: tasks, time, deliverables, files, vault items for the project |
| Content editors     | Team    | The CMS only                                                                           |
| Client admins       | Portal  | Their company's invoices, payments, documents to sign, projects, tickets, colleagues   |
| Client members      | Portal  | View their company's projects and documents, comment, approve deliverables, raise tickets |

## Two surfaces, one app

- **Team app** at `os.unbuilt.studio`.
- **Client portal** at `portal.unbuilt.studio`.

One Next.js app and one Convex deployment serve both. `proxy.ts` routes by hostname, and a portal session can never
reach a team route or a team function (see `03-auth-and-permissions.md`).

## Confirmed decisions

| Area              | Decision                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Scope             | Everything in this spec ships together                                                                      |
| Backend           | Convex (database, functions, file storage, scheduler, crons, HTTP actions)                                   |
| Auth              | Better Auth through the official Convex component. Magic link and required TOTP 2FA for the team; magic link plus email code for clients |
| Frontend          | Next.js 16 App Router, TypeScript strict, Tailwind v4, shadcn/ui                                             |
| PDFs              | `@react-pdf/renderer` in Convex Node actions                                                                 |
| Email             | Resend, templates in React Email                                                                             |
| WhatsApp          | Meta WhatsApp Cloud API with approved templates and recorded opt-in                                         |
| Payments          | Paystack payment links on invoices, bank transfer as fallback, webhook marks paid                           |
| E-signatures      | Built in-house with an evidence trail and a certificate page                                                 |
| Client portal     | Yes, same app, separate hostname and permissions                                                            |
| Permissions       | Permission keys in code, roles as sets of keys, custom roles, project membership, append-only audit log     |
| CMS               | Works, service pages, insights, legal pages, testimonials, site settings. Website stays static and rebuilds on publish |
| Repo              | Separate repo `madebyunbuilt/unbuilt-os`. The website repo stays where it is                                |
| Hosting           | Vercel for Next.js, deployed from GitHub Actions with the Vercel CLI, same model as the website             |
| Package manager   | pnpm only                                                                                                   |

## Modules

1. **CRM** — website enquiries, pipeline and deals, clients, contacts, activity timeline, rate card, calendar, intake.
2. **Projects** — projects from templates, members, milestones, deliverables and approvals, tasks, time tracking,
   change requests, weekly client updates, handover.
3. **Documents and e-signatures** — templates and clauses, quote → proposal → SOW → contract chain, versions, PDFs,
   view tracking, expiry, multi-party signing with countersignature.
4. **Billing and finance** — invoices with VAT, WHT, discounts and multi-currency, Paystack, manual payments, receipts,
   billing schedules, retainers, late fees, credit notes, refunds, write-offs, FX rates, expenses, contractors and
   bills, statements, exports.
5. **Support and SLAs** — tickets, SLA policies measured in business hours, Nigerian public holidays, retainer hours,
   monthly SLA reports, uptime monitoring and incidents, renewals of client assets.
6. **Vault** — encrypted client credentials scoped to projects, with every reveal logged.
7. **Team** — members and contractors, agreements, cost and bill rates, time off, capacity planning.
8. **Client portal** — the client-facing surface for all of the above.
9. **CMS** — the public website's content and publishing.
10. **Platform** — notifications (in-app, email, WhatsApp), search and command palette, reports, files, imports and
    exports, data requests, settings, installable PWA, dark mode.

## Glossary

| Term             | Meaning                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Client           | A company (or individual) the studio works for or might work for                                    |
| Contact          | A person at a client. May have portal access                                                          |
| Enquiry          | A raw submission from the website form                                                               |
| Deal             | A potential piece of work moving through the pipeline                                                |
| Document         | Any generated business document: quote, proposal, SOW, contract, SLA, NDA, DPA, change request, handover |
| Document chain   | The link from a quote to the proposal, SOW, contract and billing schedule derived from it           |
| Deliverable      | Something the client approves: a design, a build, a document                                        |
| Change request   | A priced change to agreed scope that the client approves                                              |
| Retainer         | A recurring monthly agreement with included hours                                                     |
| SLA policy       | Response and resolution targets per priority, measured in business hours                             |
| WHT              | Withholding tax a paying company deducts from an invoice and remits to the tax authority              |
| Work             | A public case study on the website                                                                    |
| Minor units      | The smallest unit of a currency: kobo for NGN, cents for USD and EUR                                  |

## Design

The OS follows the Unbuilt brand, adapted for a working tool.

- **Colour tokens** (from the brand kit): ink `#000000`, paper `#FFFFFF`, prussian `#11297A`, line `#BFD0FF`,
  hi-vis `#FFC400`.
- **Blue means not built yet.** Use prussian for drafts, pending and in-progress states (a draft invoice, an unsigned
  contract, a milestone in progress). Built, final and paid states are ink on paper. Hi-vis marks what needs attention:
  overdue, breached, awaiting your action. Never use blue for a primary button.
- **Type**: Anybody for display and numbers that matter (totals, headings), Instrument Sans for everything else. Load
  through `next/font`.
- **The mark**: a solid mass with the top-right quarter open, the void at 42% across and 42% down. Copy the SVGs from the
  brand kit into `public/brand/`. Do not tidy the void to 50%.
- **Density**: tables and forms first. Every list is sortable, filterable, searchable, and exportable when the user has
  the export permission.
- **Dark mode**: follow the system, with a manual override.
- **PDFs** follow the existing invoice and quote kit: mark and wordmark top left, document type and number top right,
  a meta row (issued, due, project, currency), from and billed-to blocks, line items with every second row in ink, totals
  block, payment details, terms.
- **Accessibility**: WCAG 2.2 AA. Keyboard reachable everywhere, visible focus, reduced motion respected.
