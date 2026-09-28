# 18 — Open questions

Build with the defaults below, but surface each one in settings so it can be changed without code. Do not guess beyond
these.

## For the accountant

| Question                                                                                                                           | Default in the build                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| VAT rate and which clients are zero-rated (for example foreign clients buying services) or exempt                                  | 7.5% standard; treatment set per client         |
| WHT rates that clients deduct for the studio's services, by client type                                                            | Per-client rate, suggested 5%, confirm          |
| Is WHT calculated on the amount before VAT                                                                                         | Yes                                             |
| On invoices mixing taxable and non-taxable lines, is VAT charged only on the taxable lines, with the discount shared in proportion | Yes (decided by the studio 2026-09-13; confirm) |
| WHT the studio must deduct when paying contractors and suppliers                                                                   | Per-vendor rate, empty until set                |
| Whether late fees of 5% per month are appropriate and enforceable                                                                  | Late fees disabled until confirmed              |
| Retention periods for financial records                                                                                            | 7 years                                         |
| Which exports the accountant needs and in what format                                                                              | CSV pack described in `08`                      |
| Treatment of Paystack fees in the books                                                                                            | Studio absorbs fees; fees stored per payment    |

## For the lawyer

| Question                                                                                                                                 | Default in the build                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Is the e-signature process (email code, consent, evidence, certificate) sufficient for SOWs, contracts, NDAs and DPAs under Nigerian law | Built as specified; "reviewed by counsel" toggle off |
| Contract, NDA, DPA, SLA, SOW and team agreement templates                                                                                | Plain-language drafts marked "Requires legal review" |
| Statutory deadline for data subject requests under the NDPA                                                                              | 30 days                                              |
| Whether the studio must register with the Nigeria Data Protection Commission                                                             | Flag in settings, not enforced                       |
| Transfer safeguards for processors outside Nigeria                                                                                       | Listed in the privacy notice                         |
| Portal terms and privacy notice text                                                                                                     | Draft legal pages in the CMS                         |

## For the studio

| Question                                                                 | Default in the build                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Convex deployment region                                                 | **Decided 2026-09-13:** EU West (Ireland) for dev, staging and production              |
| Is Paystack USD enabled on the business account                          | USD via bank transfer until enabled                                                    |
| Team sign-in: magic link only, or also passkeys                          | Magic link + TOTP, passkeys optional                                                   |
| Final SLA targets per policy                                             | Defaults in `09`; Standard, Priority and Retainer all start with them                  |
| Change request signature threshold                                       | ₦500,000 or equivalent                                                                 |
| Default billing schedule for fixed-price projects                        | 50% on signature, 50% on final approval                                                |
| Markup on billable expenses                                              | 0%                                                                                     |
| A card payment that arrives for more than the invoice still owes         | **Decided 2026-09-24:** take it, settle the invoice, hold the excess as credit (below) |
| Which email address receives the website enquiry acknowledgement replies | `hello@unbuilt.studio`                                                                 |
| Brand assets for PWA icons and PDFs                                      | From the existing brand kit                                                            |
| Custom domains `os.unbuilt.studio` and `portal.unbuilt.studio`           | Assumed; set up DNS once `unbuilt.studio` moves to the new Vercel setup                |
| Whether a client or a project needs a Files tab of its own               | **Decided 2026-09-27:** no, see below                                                  |

### No Files tab on a client or a project

**Decided 2026-09-27** (studio, to the builder's recommendation). The question turned out to be two:

_Finding a file somebody knows exists_ is what search in `17` is for, and a file's name is searchable content. A tab
built for this now would be half replaced by that search, and a second place to look is worse than one, because neither
place holds everything.

_Storing a file that belongs to no record_ is a real gap and stays open. Every file is owned by a record, and its
permissions come from that owner (`FILE_ACCESS` in `convex/lib/files.ts`, where a table with no rule is readable by
nobody). A client's brand kit, fonts or supplied copy own no record: deliverables are outputs and documents are
contracts. Today those arrive by email, which is what this replaces.

It is not built now because the cost is not the screen. It is a new sharing surface for `clients` and `projects` as file
owners, a default for per-file client visibility where the safe choice makes the feature useless and the useful choice is
the leak, and retention and legal hold behaviour — which is `18`'s own work in the build sequence. All three land
together there, by which time use will have shown whether anyone needs it.

**Revisit at step 18**, or sooner if clients start being asked to email assets. The piece to pull forward first is the
portal upload page: `portal.vault.submit`'s neighbour `portal.files.upload` already exists and is used only for ticket
attachments, and a client sending an asset can hang off the client record without a Files tab existing at all.

The inert "Files" tab has been removed from the client and project pages. Leaving it visible advertised something the
studio had decided against.

### The overpaid card payment

`payments.recordFromPaystack` refuses anything larger than the balance, so the webhook fails and nothing is written
down. It happens when the balance moves while a client has the checkout open — a transfer is recorded, or a credit note
is applied, in the hour the Paystack link lives. The client's money has left their account and the studio's books do
not show it until somebody reads the Paystack dashboard.

**Decided 2026-09-24** (studio, to the builder's recommendation): take the payment, settle the invoice, and put the
excess on the client's account as held credit, the way a credit note already does, so an overpayment becomes a balance
to spend or refund rather than a silent failure. Not yet built — it waits until the payments code is open again, since
the current behaviour refuses the payment rather than recording a wrong number, which fails in the safe direction.
