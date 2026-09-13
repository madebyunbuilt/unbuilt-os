# 18 — Open questions

Build with the defaults below, but surface each one in settings so it can be changed without code. Do not guess beyond
these.

## For the accountant

| Question                                                                 | Default in the build                     |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| VAT rate and which clients are zero-rated (for example foreign clients buying services) or exempt | 7.5% standard; treatment set per client |
| WHT rates that clients deduct for the studio's services, by client type  | Per-client rate, suggested 5%, confirm   |
| Is WHT calculated on the amount before VAT                               | Yes                                      |
| WHT the studio must deduct when paying contractors and suppliers         | Per-vendor rate, empty until set         |
| Whether late fees of 5% per month are appropriate and enforceable        | Late fees disabled until confirmed       |
| Retention periods for financial records                                  | 7 years                                  |
| Which exports the accountant needs and in what format                    | CSV pack described in `08`               |
| Treatment of Paystack fees in the books                                  | Studio absorbs fees; fees stored per payment |

## For the lawyer

| Question                                                                  | Default in the build                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Is the e-signature process (email code, consent, evidence, certificate) sufficient for SOWs, contracts, NDAs and DPAs under Nigerian law | Built as specified; "reviewed by counsel" toggle off |
| Contract, NDA, DPA, SLA, SOW and team agreement templates                  | Plain-language drafts marked "Requires legal review"  |
| Statutory deadline for data subject requests under the NDPA               | 30 days                                               |
| Whether the studio must register with the Nigeria Data Protection Commission | Flag in settings, not enforced                     |
| Transfer safeguards for processors outside Nigeria                        | Listed in the privacy notice                          |
| Portal terms and privacy notice text                                      | Draft legal pages in the CMS                          |

## For the studio

| Question                                                                  | Default in the build                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Convex deployment region                                                  | Choose at project creation; record the choice here    |
| Is Paystack USD enabled on the business account                           | USD via bank transfer until enabled                   |
| Team sign-in: magic link only, or also passkeys                           | Magic link + TOTP, passkeys optional                  |
| Final SLA targets per policy                                              | Defaults in `09`                                      |
| Change request signature threshold                                        | ₦500,000 or equivalent                                |
| Default billing schedule for fixed-price projects                         | 50% on signature, 50% on final approval               |
| Markup on billable expenses                                               | 0%                                                    |
| Which email address receives the website enquiry acknowledgement replies  | `hello@unbuilt.studio`                                |
| Brand assets for PWA icons and PDFs                                       | From the existing brand kit                           |
| Custom domains `os.unbuilt.studio` and `portal.unbuilt.studio`            | Assumed; set up DNS once `unbuilt.studio` moves to the new Vercel setup |
