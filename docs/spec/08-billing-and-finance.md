# 08 — Billing and finance

All calculations use `convex/lib/money.ts` and the rules in `04-data-model.md` (minor units, basis points, calculation
order). Tax rates in this file are defaults to be confirmed; see `18-open-questions.md`.

## Invoices

### Creating

Sources:
- manual
- a billing schedule item
- a retainer period
- approved time entries (time and materials)
- approved billable expenses
- an approved change request
- a managed asset renewal
- a late fee

An invoice records:
- **Client and project**, and the contract it falls under.
- **Currency.** Defaults from the client. NGN, USD or EUR.
- **FX rate to NGN.** Defaults to the latest `fxRates` entry for the currency, and is editable until the invoice is sent.
- **Line items**, from the rate card or free text, with quantity, unit price and a taxable flag.
- **Discount**: none, a percentage, or a fixed amount.
- **VAT.** Applies by default when the client's VAT treatment is `standard`, at the org default rate (750 bps). Not
  applied for `zero_rated` or `exempt`, and the PDF prints the treatment instead.
- **WHT.** Applies by default when the client has `whtApplies`, at the client's rate. It is informational on the
  invoice: the invoice total is not reduced, and a note shows the expected deduction.
- **Dates**: issue date, due date (from payment terms), notes and terms.

### Lifecycle

`draft → (scheduled) → sent → viewed → partially_paid → paid`, with `overdue` set by cron when unpaid past the due date,
`void` (never paid, reason required), and `written_off` (unpaid balance abandoned, `invoices.writeoff`).

- **Send**:
  1. Assign the number.
  2. Freeze the lines, totals and FX rate.
  3. Render the PDF with its hash.
  4. Create the pay token.
  5. Create the Paystack transaction if the currency is supported.
  6. Email the billing contacts with the PDF and a pay link (and WhatsApp by preference).
- **Sent invoices are immutable.** Corrections are made with a credit note, or by voiding (only if no payment exists)
  and issuing a new invoice.
- `invoices.create` without `invoices.send` can only create drafts; drafts appear in a "Ready to send" queue for Finance.

### Reminders

Daily cron at 09:00 Lagos time:
- 3 days before the due date
- on the due date
- 3, 7 and 14 days after the due date
- then weekly until paid, voided or written off

Each reminder is sent once and recorded on `invoices.reminders`. Clients or invoices can be set to "no reminders".

### Late fees

- When `orgSettings.lateFeePolicy.enabled`, an invoice still unpaid after due date + grace days gets a **separate**
  `late_fee` invoice. It is monthly, at `monthlyBps` of the outstanding balance, linked through `lateFeeParentInvoiceId`,
  and never compounded on previous late fees.
- Created as drafts for Finance to review by default; a setting allows auto-send.
- `invoices.latefees.waive` can void a late fee with a reason.

## Payments

### Paystack

- On send, for currencies Paystack supports on the studio's account (NGN; USD only if enabled for the business),
  initialise a transaction:
  - amount = current balance in minor units
  - the billing contact's email
  - reference `inv_<invoiceId>_<attempt>`
  - `callback_url` to `/pay/[token]/done`
- The pay page (`/pay/[token]`, and the portal invoice page) shows the invoice and a Pay button that opens Paystack
  checkout, refreshing the transaction if the amount changed or the link expired.
- **Webhook** `POST /webhooks/paystack` (see `14-platform.md` for webhook rules):
  1. Verify the `x-paystack-signature` HMAC-SHA512 with the secret key.
  2. Store the event in `webhookEvents` (idempotent by event id).
  3. On `charge.success`, call Paystack's verify-transaction endpoint to confirm the amount, currency and status.
  4. Record a `payments` row.
  5. Update the invoice balance and status, and generate and send the receipt.
- The callback page never marks an invoice paid on its own; only a verified webhook or the verify endpoint does.
- Paystack fees: setting "absorb fees" (default). Fees from the verify response are stored on the payment for reporting.
- EUR invoices, and USD when Paystack USD is not enabled, show bank transfer details only.

### Manual payments

- `payments.record`: amount, currency (must match the invoice), date, method, reference, proof file, and any WHT deducted.
- Partial payments are allowed. Overpayment is rejected; the user records the exact balance and handles the rest as a
  credit.

### Withholding tax

When a client deducts WHT, they pay less than the invoice total and remit the difference to the tax authority on the
studio's behalf.
- Recording a payment asks for "WHT deducted" (defaults to the expected WHT when the payment equals total − expected WHT).
- The invoice is settled when paid + WHT credited + credit notes = total.
- Each deduction creates a `whtCredits` row with status `expected`. Finance uploads the WHT credit note or receipt when
  it arrives; the row moves to `certificate_received`.
- Report: WHT credits outstanding by client and age, because they offset the studio's own tax.

### Receipts

- Every successful payment generates a receipt (`UNB-RCT-0001`) PDF, emailed to the billing contacts and available in
  the portal.

### Refunds

- `payments.refund`: full or partial. For Paystack payments, call the refund API and track status through the webhook.
  For manual payments, record how it was refunded.
- A refund reopens the invoice balance unless it is paired with a credit note.

## Credit notes

- `creditnotes.create` against a sent invoice: lines or an amount (never more than the invoice total minus existing
  credits), reason, PDF (`UNB-CN-0001`).
- Applied to the invoice balance immediately. If the invoice was already paid, the credit is refunded or held as client
  credit for the next invoice. Held credit shows on the client and can be applied to a future invoice in the same currency.

## Write-offs

- `invoices.writeoff` with a reason moves the unpaid balance to written off. It appears in reports as bad debt and can
  be reversed by the same permission if the client later pays.

## Billing schedules

- Created from an SOW, a contract, a project template, or manually.
- Items are percentages of a project amount or fixed amounts, triggered by:
  - signing
  - a date
  - a milestone approval
- When triggered, the item creates an invoice draft (or sends it when `autoSend`) and records the invoice on the item.
- Defaults for new fixed-price projects: 50% on signature, 50% on final milestone approval. Editable per project.
- The schedule total must equal the project amount before the schedule can be activated.

## Retainers

- Monthly fee, included hours, overage rate, invoice day, auto-send.
- On the invoice day, a cron:
  1. Closes the previous period.
  2. Creates the next `retainerPeriods` row, with rollover if enabled.
  3. Creates the retainer invoice.
  4. If the closed period's used minutes exceeded included minutes, creates an overage invoice from the approved time
     entries at the overage rate.
- Usage alerts at 80% and 100% of included hours go to the project manager and client admins.

## Foreign exchange

- `fx.manage` maintains `fxRates` per currency and date (manual entry; a provider can be added later behind the same table).
- Sending a non-NGN invoice without a rate for that currency within the last 7 days is blocked with a prompt to update
  the rate.
- All reports show NGN totals using each record's stored rate, with the original currency available.

## Expenses

- Logged by members (`expenses.log`) with receipt, project, category, amount, currency, billable flag.
- Approved by `expenses.approve`. Approved billable expenses can be added to an invoice at cost or with a markup
  (setting).
- Reimbursable expenses are marked reimbursed when paid back.

## Vendors and bills

- Vendors: contractors (optionally linked to a team member) and suppliers, with bank details (sensitive) and optional WHT
  the studio must deduct when paying them.
- Bills: amount, currency, dates, project, file. Status draft → approved → scheduled → paid.
- Bills due within 7 days and overdue bills notify `bills.pay` holders.
- Paying a bill records the date and reference; the studio's WHT deduction on vendor payments is recorded for remittance.

## Statements and exports

- **Client statement of account** for a date range: opening balance, invoices, payments, credit notes, WHT credits,
  closing balance, per currency. PDF and portal view.
- **Exports** (`finance.export`, CSV):
  - invoices
  - payments
  - credit notes
  - WHT credits
  - expenses
  - bills
  - VAT summary by month (VAT charged on sent invoices, by treatment)
  - an accountant pack that zips all of the above for a date range

## Acceptance criteria

- Totals match a table of fixture cases covering discount (percent and fixed), VAT on and off, WHT on and off, multiple
  lines, fractional quantities and rounding, identical in the app, the portal and the PDF.
- A sent invoice cannot be edited; only credit notes or void (without payments) change its effect.
- Concurrent sends never produce duplicate invoice numbers.
- A Paystack webhook with an invalid signature is rejected; a valid event processed twice records one payment.
- The callback redirect alone never marks an invoice paid.
- A payment plus WHT credited plus credit notes equal to the total marks the invoice paid; less leaves it partially paid.
- Late fees are separate invoices, never compound, and are created at most once per invoice per month.
- Retainer periods roll over correctly and overage invoices include only approved time beyond included minutes.
- Sending a non-NGN invoice without a recent FX rate is blocked.
- Reports in NGN use stored rates, and changing today's rate does not change past totals.
- A billing schedule whose items do not sum to the project amount cannot be activated.
