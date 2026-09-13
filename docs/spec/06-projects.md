# 06 — Projects and delivery

## Projects

- Created from a won deal, from a template, or blank. A project always belongs to one client.
- Fields: code (`UNB-P-0001`), name, type, status, billing model (fixed, time and materials, retainer), budget, dates,
  manager, members, contract document, SLA policy, links (repo, staging, production, design).
- Project page tabs:
  - **Overview**: status, progress by milestone, budget used, hours logged versus estimate, open tasks, open tickets,
    next milestone, latest client update.
  - **Milestones and deliverables**
  - **Tasks**
  - **Time**
  - **Change requests**
  - **Documents**
  - **Invoices**
  - **Files**
  - **Vault**
  - **Tickets**
  - **Updates**
  - **Handover**
  - **Settings**
- **Budget used** = time at cost rate + approved expenses + bills. Shown against the budget and against billed amount.
  Only visible with `reports.finance.view`.
- Status changes are recorded on the timeline. Completing a project requires every milestone to be approved or
  explicitly skipped, and starts the handover checklist.

## Templates

- A template defines milestones (with offsets from the start date and optional billing percentages), deliverables per
  milestone, tasks with estimates, an intake form and default checklists.
- Default templates to seed: Mobile app, Web platform, Product design, Backend, DevOps setup, Retainer.
- Creating a project from a template creates all of this with real dates, and a billing schedule when percentages are
  set.

## Members

- Adding a member to a project grants them the project's `.assigned` scope (see `03-auth-and-permissions.md`).
- Project roles are labels (lead developer, designer, QA) and do not change permissions.
- Removing a member revokes access to that project's vault items, files and tasks immediately.

## Milestones and deliverables

- Milestones have a due date, status, and an optional billing amount or percentage linked to the billing schedule.
- Deliverables belong to a milestone and carry versions (files and links with notes).
- **Review flow**:
  1. The team submits a version, and the deliverable moves to `in_review`.
  2. The client's contacts are notified in the portal.
  3. The client either approves or requests changes with comments.
  4. When every deliverable in a milestone is approved, the milestone becomes `approved`. If the billing schedule has an
     `on_milestone_approved` item, the invoice draft is generated (and sent if `autoSend`).
- Approvals record the contact, time, IP and the version approved. An approved version cannot be edited; new work is a
  new version.

## Comments

- Comments attach to deliverables, tasks, change requests, tickets and documents.
- Visibility is `internal` or `client`. Internal comments never reach portal functions; test this.
- @mentions notify team members; client-visible comments notify the client's relevant contacts.

## Tasks

- Board (by status) and list views, filters by assignee, milestone, priority, due date.
- Tasks can link to a ticket or change request.
- Assignees must be project members.
- Overdue tasks surface on the assignee's dashboard and the project overview.

## Time tracking

- Members log time against a project, optionally a task or ticket: date, minutes, description, billable flag.
- A start/stop timer is available in the app header; stopping it creates a draft entry.
- Entries snapshot the member's cost and bill rate at the time of logging.
- **Weekly submission**: members submit their week; `time.approve` holders approve or return entries with a note.
- Approved billable time on time-and-materials projects can be pulled into an invoice. Invoiced entries are locked.
- Retainer time counts against the retainer period (see `09-support-and-sla.md`).

## Change requests

- Created by the team when scope changes: title, description, reason, price impact (amount and currency), time impact
  (days).
- Sending generates a `change_request` document from its template and makes it visible in the portal.
- The client admin approves or declines in the portal. Approval can require a signature (setting per client, default on
  for amounts above a configurable threshold).
- **On approval**:
  - Update the project budget and due date.
  - Add the amount to the billing schedule as a new item, or create an invoice draft, following the setting on the
    change request.
  - Record the approval on the timeline.
- Declined change requests stay on record with the reason.

## Client status updates

- Each active project produces a weekly draft update every Friday at 12:00 Lagos time. The draft contains:
  - milestones completed and upcoming
  - tasks done this week
  - hours used, for retainers
  - open risks, entered by the project manager
- The project manager edits and sends it. Sending posts it to the portal and emails the client's contacts.
- A draft not sent by Monday 12:00 notifies the project manager.

## Handover

- Completing a project creates a handover checklist from the template. Defaults:
  - Repository ownership transferred
  - Domains and DNS access transferred
  - Hosting and third-party accounts transferred
  - Vault credentials handed over and rotated
  - App store listings transferred
  - Documentation delivered
  - Final invoice paid
  - Ownership of the work transferred (issued only once the final invoice is paid)
  - Handover document signed
  - Testimonial requested
  - Case study drafted
- **Ownership transfer is gated.** The "Ownership of the work transferred" item cannot be ticked while any invoice on the
  project has a balance.
- Completing the checklist sets `handoverStatus = complete`. It also:
  - offers to archive the project's vault items
  - creates a draft case study in the CMS, pre-filled from the project (see `13-cms-and-website.md`)
  - sends the client a testimonial request with a portal link

## Acceptance criteria

- Creating a project from a template creates milestones with correct dates, tasks, the intake request and a billing
  schedule when percentages are defined.
- A Member not on a project cannot read its tasks, files, deliverables, comments, time or vault items.
- Approving the last deliverable in a milestone sets the milestone to approved and creates the scheduled invoice draft.
- Internal comments are never returned by any portal function.
- Time entries keep the rate that applied when logged, even after the member's rate changes.
- Invoiced time entries cannot be edited or deleted.
- An approved change request updates budget, due date and billing exactly once.
- "Ownership of the work transferred" cannot be completed while a project invoice has a balance.
- The weekly update draft is created on schedule and the reminder fires if unsent.
