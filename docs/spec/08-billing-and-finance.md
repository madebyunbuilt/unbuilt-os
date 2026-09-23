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

## Decisions and rules (studio, 2026-09-22)

- **Payment terms**: an invoice takes the client's terms, else the studio's default, else **14 days**. The due date is
  set when it is sent: the studio's date that day plus the terms.
- **Void** is allowed only while nothing has been paid, credited or recorded as WHT against the invoice. Anything with
  money on it is corrected with a credit note. A draft is deleted instead, unless it already carries a number (a send
  that failed after numbering), in which case it stays on record.
- **Credit notes and VAT**: a credit note's amount includes VAT in the same share as its invoice, so crediting reverses
  net and VAT in proportion, and the VAT summary shows the reduction.
- **Credit on a paid invoice** is held as client credit in that currency by default, and Finance applies it to a later
  invoice by hand, or refunds it instead. Nothing is applied automatically.
- **Recipients**: an invoice goes to the client's billing contacts, or the primary contact when none is marked, unless
  the sender chooses others.
- **Sending** is checked in `invoices.send` and carried out by a scheduled Node action: number it (once; a retry keeps
  the number), set its dates, freeze its lines, totals and rate, render the PDF with its hash, then email the recipients
  with the PDF attached. It stays a draft until the email is away, and whoever pressed send is told if any step fails.
- **Until online payments (step 8)**, invoices carry no pay link: the PDF shows the studio's bank accounts in the
  invoice's currency and asks for the invoice number as the reference.
- **FX**: a rate is entered per currency per day (`fx.manage`; entering the same day again replaces it, and future days
  are refused). A draft takes the latest rate, or a rate typed on it, which is then kept at send; otherwise the latest
  rate is taken again at send. A USD or EUR invoice is refused unless the latest rate is at most 7 days old.
- **The PDF** prints amounts with the currency code (the standard fonts have no ₦ or minus sign), the VAT rate, or the
  client's VAT treatment when none is charged, and the expected WHT as a note under the total, which it never reduces.
  Its file belongs to the invoice, is client-visible, and is read by `invoices.view` holders.

- **A credit note bigger than what is still owed** (because the client had already paid part) clears the balance, and
  the rest is held as client credit: on a ₦100,000 invoice with ₦60,000 paid, a ₦50,000 credit applies ₦40,000 (the
  invoice is paid) and holds ₦10,000. One credit note records the whole correction.
- **Credit notes** are raised against a sent invoice (not a draft, void or written-off one) by lines, priced at the
  invoice's VAT rate, or by one amount including VAT. The total credited on an invoice never exceeds its total. Each
  gets its PDF and is emailed to the billing contacts unless unticked.
- **Held credit** is applied to another open invoice of the same client in the same currency by `payments.record`
  holders, never more than it or the invoice's balance, or refunded (`payments.refund`) without touching any invoice.
- **Payments** are recorded against a sent, opened, partly paid or overdue invoice, dated today or earlier, with any
  WHT withheld; payment + WHT above the balance is refused. Each one numbers a receipt in the same transaction; its PDF
  is emailed to the billing contacts unless "Email the receipt" was unticked. A failed PDF or email leaves the money
  recorded and tells whoever recorded it.
- **A refund of a payment** reopens the invoice's balance by the same amount.
- **WHT credits** start expected, move to certificate received (with the number and file), or can be flagged
  disputed. A disputed deduction can be **reversed**: it goes back onto the invoice as owed, reopening it, with the
  reason kept (studio, 2026-09-22).
- **Write-off** moves the remaining balance to bad debt with a reason, keeping every payment; money cannot be recorded
  on it until the write-off is reversed, which makes the balance owed again.
- **The invoice's status** after any of these comes from one rule: balance 0 is paid, past due is overdue, money
  received (a payment or WHT) is partly paid, otherwise opened or sent. Credits correct an invoice rather than pay it,
  so they never make it partly paid, and one settled entirely by credit is shown as "Credited in full".
- **Expected WHT after a credit** is scaled to what is still owed (`money.whtExpectedOnBalance`): the invoice keeps the
  figure it was sent with, and the page and the payment form use the scaled one.
- **What the client reads** says only what applies to them: the invoice email and PDF mention withholding tax only when
  that client deducts it, and then in their own figures; the studio's accounts for the invoice's currency are printed in
  the invoice and reminder emails as well as the PDF, and nothing promises bank details that are not there. The tax
  office's document is called the **WHT certificate** everywhere, so it is never confused with the studio's credit
  notes. A receipt says what is still owed, or that the invoice is settled; a credit note says the same and names any
  credit held for the client.
- **The VAT line always shows an amount**, never a dash: "VAT at 7.5%" with the amount when it is charged, otherwise
  "VAT (zero-rated)", "VAT (exempt)" or "VAT" with ₦0.00, so a reader can see VAT was considered and why it is nothing.
  The total is the work itself; only the VAT is zero.
- **A line's VAT box shows only while the invoice charges VAT**, and an invoice charging VAT with no line carrying it
  says so on the draft and the page, without blocking it.
- **A new invoice shows what the client is charged** before it is created: VAT and WHT start from the client's own
  treatment (`invoices.defaultsFor`) and can be changed on the spot.
- **The WHT box on a payment follows the amount** received, in the invoice's proportion (`money.whtForPayment`: ₦10,000
  received on an invoice expecting ₦6,000 WHT on ₦215,000 comes with ₦287.08), never taking the two past what is owed,
  until a figure is typed into it; the client's remittance advice is the authority.

- **Overdue**: past its due date with money still owed is overdue, whether or not part was paid (studio, 2026-09-22).
  The daily run at 09:00 Lagos marks it; a payment that leaves money owed keeps it overdue.
- **Reminders** go at 09:00 Lagos with the overdue marking: 3 days before the due date, on it, 3, 7 and 14 days after,
  then every 7 days, each once, recorded before its email is scheduled. After a missed day only the latest reminder
  due is sent, never a stale one. Each goes to the contacts the invoice was sent to (or the billing contacts), states
  what is still owed, and attaches the invoice PDF again (studio, 2026-09-22). "No reminders" can be set on an invoice
  or a client (`invoices.update`). A failed email tells whoever drafted the invoice.
- **Statements** list, per currency, the opening balance, each invoice, payment, WHT credit, credit note and refund in
  the range with a running balance, and the closing balance; below zero means the client is in credit. Write-offs are
  never shown to the client (studio, 2026-09-22), so a written-off invoice is left off entirely, with everything
  recorded against it; void invoices never count. Held credit applied later is not a line of its own. `invoices.view`
  holders read a statement on screen or ask for its PDF, which is rendered by an action and kept. The portal view comes
  with the client portal.

## Decisions and rules (studio, 2026-09-23)

- **The card button charges the full balance**, never part of it. Staged agreements are billing schedules (an invoice
  per stage); a one-off part payment is a bank transfer Finance records.
- **A client who withholds tax** can tick that on the pay page: the checkout is then for the balance less the expected
  WHT, the rest being what they remit, and the invoice is partly paid until the WHT credit is recorded. The withheld
  amount travels in the transaction's metadata and is recorded with the payment.
- **The studio absorbs Paystack's fee.** The client is charged exactly what is owed; the fee from the verified
  transaction is stored on the payment for reporting. Charging the client the fee would make the payment differ from the
  invoice; a studio wanting that puts it on the invoice as a line.
- **The transaction is created when the client presses Pay**, not when the invoice is sent, so it always charges what is
  owed at that moment (a payment or credit note in between never leaves a stale link). The reference is
  `inv_<invoiceId>_<attempt>`.
- **Nothing is recorded from the browser.** The callback page only says the payment is being confirmed and refreshes;
  the money is recorded when Paystack's webhook signature verifies and the transaction is confirmed with Paystack's own
  verify endpoint. The payment is keyed by its reference, so a repeated event records one payment.
- **Pay links follow the signing links' rule**: only the token's hash is stored, and each invoice email or reminder
  carries a freshly minted link, so the ones before it stop working.
- **Card refunds** go through Paystack: the refund is recorded as pending, the invoice's balance reopens at once, and
  the refund is marked processed when Paystack's webhook says so. A failure tells whoever asked for it.
- **How the client paid is recorded**, from the verified transaction's `channel` and authorization: "Card · visa ending
  4081", "Bank transfer · GTBank", "USSD". It shows on the invoice's payments and on the receipt, in place of the bare
  method.
- **Which currencies take cards** comes from `PAYSTACK_CURRENCIES` (NGN unless the studio's account has more); anything
  else shows bank transfer only, as does a deployment with no Paystack key.

## Screens

- **Finance → Invoices** (`/billing/invoices`, `invoices.view`): invoices newest first, showing what is waiting for money
  by default, with status, total, what is still owed and the due date. "New invoice" (`invoices.create`) chooses the
  client, an optional project, the currency, the lines (rate card items fill description and price), a discount, the
  payment terms, a rate for USD or EUR, notes and terms.
- **The invoice page** shows the lines and totals, what has been paid, withheld and credited, and what is still owed,
  then its payments (with receipts to download), WHT credits and credit notes. What it offers depends on its state and
  the viewer's permissions:
  - a draft: send it, to the billing contacts ticked or others (`invoices.send`); edit it, including VAT and WHT
    (`invoices.update`); delete it if it was never numbered;
  - open: record a payment, starting at what is still owed, or at the total less the expected WHT on a first payment
    (`payments.record`); apply held credit in the same currency; issue a credit note, showing what will be held when it
    exceeds the balance (`creditnotes.create`); refund a payment (`payments.refund`); record a WHT certificate, dispute
    it or reverse it; write it off (`invoices.writeoff`); void it while nothing is on it (`invoices.void`); switch its
    reminders off (`invoices.update`);
  - written off: reverse the write-off.
- **The client's Invoices and payments tab** (`invoices.view`): their invoices, any credit held for them (paid back with
  `payments.refund`), their statement for a date range with its PDFs, and whether they get reminders.
- **`/pay/[token]`**, on either host without a session: what is still owed and when it was due, a Pay button that opens
  Paystack (with a tick for a client who withholds tax, showing the reduced amount), and the studio's bank details with
  the invoice number as the reference. Coming back from Paystack it says the payment is being confirmed and refreshes
  itself until the webhook lands. A settled invoice says so; a stale link says to use the newest email.
- **Settings → Exchange rates** (`fx.manage`): the latest rate per currency and whether it is recent enough to send
  with, a form to set a day's rate, and the recent history.

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
