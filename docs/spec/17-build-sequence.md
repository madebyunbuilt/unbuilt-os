# 17 — Build sequence

Everything ships as one release. This order exists because later work depends on earlier work. Each step is a branch
and pull request (or several), merged when its definition of done is met.

## Definition of done (every step)

- Acceptance criteria in the module file pass, each covered by a test.
- Permission tests exist for every new exported function.
- `pnpm check` and `pnpm test` pass in CI; the preview deploys.
- UI works at 360 px and in dark mode, and is keyboard-navigable.
- The spec is updated in the same PR if implementation required a change.

## Order

1. **Foundation**
   - repo, tooling, CI/CD, environments
   - Convex schema skeleton
   - Better Auth (team magic link + TOTP, portal magic link + code)
   - function wrappers, permission keys and default roles, audit log
   - files, settings, counters, money library, business time library
   - app shell for both surfaces (layout, navigation, command palette shell, notifications shell, dark mode, PWA manifest)
   - seed script
2. **Team** — members, invites, onboarding checklist, rates, time off, holidays.
3. **CRM** — enquiries (with the public endpoint), clients, contacts, pipeline and deals, activity timeline, rate card.
4. **Projects** — templates, projects, members and scope, milestones, deliverables and versions, comments, tasks, time
   tracking and approval. **Client status updates and handover are specified in `06-projects.md` and were left out of
   this list** (studio, 2026-09-27); their permissions (`updates.send`, `handover.manage`) and the `handoverStatus`
   field were built here, and the tabs have sat marked "not built yet" ever since. They belong with communications in
   step 15, where an update is something a client is actually sent.
5. **Documents** — templates and clauses, variables, versions, PDF rendering, document chain, sending, view tracking,
   expiry.
6. **E-signatures** — signature requests, signing ceremony, certificate, countersignature, verification.
7. **Billing core** — invoices, totals, VAT, WHT, sending, PDFs, reminders, FX rates, manual payments, receipts, credit
   notes, write-offs, statements.
8. **Payments** — Paystack initialise, pay pages, webhook, verification, refunds.
9. **Billing automation** — billing schedules, change requests, retainers and periods, late fees, expenses, vendors and
   bills.
10. **Client portal** — every portal page, portal roles, client admin colleague management, token pages. Terms
    acceptance moved to step 14 (studio, 2026-09-25): the terms are CMS legal pages, which do not exist until then, so
    building the acceptance here would ask clients to consent to nothing.
11. **Support** — SLA policies, tickets, business-time timers, breaches, inbound email, retainer hours, monthly SLA
    reports.
12. **Monitoring and renewals** — monitors, incidents, managed assets, renewal reminders and invoices.
13. **Vault** — encryption, reveal flow, client submissions, rotation, access logs.
14. **CMS** — works, service pages, insights, legal pages, testimonials, settings, revisions, preview tokens, publishing
    and deploy hook, site content endpoint, project-to-case-study, website migration import. Also portal terms
    acceptance, carried over from step 10: the legal pages built here are what a client is being asked to accept.
15. **Communications** — Resend templates and webhook, WhatsApp templates, opt-in, status webhook, the full event
    catalogue, preferences. Also **client status updates and project handover** from `06-projects.md`, carried over
    from step 4: both are things a client is sent, so they want the sending to exist first.
16. **Calendar and intake** — Google Calendar OAuth, meetings, booking pages, intake forms.
17. **Reports, search and dashboards** — aggregates, role dashboards, every report, exports. Also the rest of the
    command palette (studio, 2026-09-26): search across records, the quick actions `14-platform.md` names, and the
    keyboard shortcuts listed under `?`. Step 1 built the palette _shell_ — the dialog and jumping to pages — and no
    later step claimed what was left, so all three were invisible until somebody went looking. They belong here
    because search has to reach every module, including CMS works and vault labels, and building it before those
    exist would mean building it twice, with the second pass the one that got rushed.
18. **Data and compliance** — imports, full export, privacy requests, retention cron, legal holds.
19. **Hardening** — end-to-end flows from `16-key-flows.md`, security headers, rate limits review, backup and restore test,
    performance pass, accessibility audit.
20. **Website PR** — in `madebyunbuilt/unbuilt-studio-web`: build-time content loader, service landing pages, insights,
    enquiry endpoint, image hosts, fallback snapshot.

## Launch checklist

- Owner account created with 2FA; roles reviewed.
- Paystack live keys, webhook URL registered and tested with a real ₦100 transaction and refund.
- Resend domain verified (SPF, DKIM, DMARC); `support@` inbound verified.
- WhatsApp business verified and templates approved.
- Google OAuth consent screen verified for calendar scopes.
- Turnstile keys for the website domain.
- Vault keys generated and stored; rotation tested.
- Backup restore test recorded.
- Lawyer sign-off recorded for contract, NDA, DPA templates and the signature process.
- Accountant confirmation recorded for VAT, WHT and retention settings.
- Movable public holidays confirmed for the year.
- Existing clients, open invoices and website content imported and checked.
- Website switched to the OS content endpoint and enquiry endpoint, with its privacy page updated.
