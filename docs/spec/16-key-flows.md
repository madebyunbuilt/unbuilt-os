# 16 — Key flows

These cross several modules. Each becomes a Playwright test.

## 1. Enquiry to paid deposit

1. A visitor submits the website enquiry form → `POST /public/enquiries` creates an enquiry and notifies the team.
2. A PM converts it → client, contact and a deal in "New".
3. The PM books a discovery call from the deal → Google Calendar event, meeting on the timeline.
4. The PM creates a quote from the rate card → sends it → client views it (owner notified) → accepts in the portal.
5. The PM creates a proposal and then an SOW from the quote (document chain) → the SOW includes milestones and a billing
   schedule of 50% on signature, 50% on final approval.
6. The PM moves the deal to Won and creates the project from the "Web platform" template.
7. The SOW goes for signature: the client admin signs → the studio owner countersigns → certificate generated → the
   document is signed.
8. The `on_signature` schedule item creates the deposit invoice → Finance sends it.
9. The client pays with Paystack → webhook verified → payment, receipt, invoice paid → timeline and notifications updated.

## 2. Delivery with a change request

1. Members log time and move tasks; the project manager sends the weekly update.
2. A designer submits a deliverable version → the client requests changes → a new version → the client approves → the
   milestone is approved.
3. The client asks for an extra feature → the PM raises a change request (₦1,200,000, 10 days) → the client admin
   approves in the portal (signature required above the threshold) → budget, due date and billing schedule updated.
4. The final milestone is approved → the final invoice is generated and sent.

## 3. Payment with withholding tax

1. An invoice for ₦1,000,000 + 7.5% VAT = ₦1,075,000 is sent to a client with WHT at 5% (expected WHT ₦50,000).
2. The client transfers ₦1,025,000.
3. Finance records the payment with WHT deducted ₦50,000 → invoice paid, WHT credit expected.
4. The WHT credit note arrives → Finance uploads it → the credit moves to certificate received.

## 4. Retainer month with an SLA breach

1. On the invoice day, the retainer cron closes last month, opens this month, creates the retainer invoice and an overage
   invoice for 6 hours over.
2. The client raises a P2 ticket at 16:30 on a Friday before a public holiday Monday → due times skip the weekend and
   holiday.
3. The assignee replies after the first-response target → breach recorded, notifications sent.
4. Time logged on the ticket counts toward the retainer; the 80% alert fires.
5. On the first business day of next month, the SLA report shows the breach and uptime; the PM sends it.

## 5. Site down

1. A monitored production URL fails twice → incident opened, P1 ticket created, team notified by WhatsApp.
2. The site recovers → incident resolved, ticket updated, uptime reflected in the month's report.

## 6. Renewal

1. A client domain renews in 30 days → the renewal invoice draft is created and the billing contact is reminded.
2. Finance sends the invoice; the client pays; the PM marks the asset renewed with the new date.

## 7. Credentials and offboarding

1. The client submits hosting credentials in the portal → encrypted on submit.
2. A developer on the project reveals them (2FA re-verified) → access logged.
3. The developer is offboarded → sessions revoked, project membership removed, the PM is prompted to rotate the
   credentials they revealed.

## 8. Handover to case study

1. The final invoice is paid → the handover checklist can be completed, including ownership of the work transferred.
2. Handover completes → vault items archived, a draft case study created in the CMS, a testimonial request sent.
3. The client gives permission to publish → the content editor completes the SEO fields and publishes → the website
   rebuilds through the deploy hook.

## 9. Privacy request

1. A former contact asks for deletion → the request is logged with its due date.
2. The admin runs the plan: invoices and signed documents are anonymised, other records deleted → audit entries written.
