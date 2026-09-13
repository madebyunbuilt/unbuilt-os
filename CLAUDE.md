# Unbuilt OS

The studio's operating system: CRM, projects, documents and e-signatures, billing, support, vault, team, client portal
and the website CMS. The full specification is in `docs/spec/`; start with `docs/spec/README.md`.

## Before any work

- Read `docs/spec/01-product.md`, `02-architecture.md`, `03-auth-and-permissions.md` and `04-data-model.md`.
- Then read only the module file for the task, plus `16-key-flows.md` if the work crosses modules.
- Follow `docs/spec/17-build-sequence.md` for order and the definition of done.
- Next.js 16 differs from older versions. Check the bundled docs described in `AGENTS.md` before writing Next.js code.
- If the spec does not answer a question about money, tax, signatures, permissions or personal data, stop and ask.
  Do not invent the rule. Check `18-open-questions.md` first.

## Rules that always apply

- pnpm only. Never npm or npx; use `pnpm dlx` for one-off tools.
- Convex functions must use the wrappers in `convex/lib/functions.ts`. Never export raw `query`, `mutation` or `action`.
- Money is integer minor units with a currency; percentages are basis points; totals only through `convex/lib/money.ts`.
- Timestamps are UTC epoch milliseconds; SLA and business rules use `convex/lib/businessTime.ts`.
- Sent, signed, issued and paid records are immutable. Corrections go through new versions, credit notes or void.
- Never store or log plaintext secrets.
- Every new exported function gets permission tests, including a portal test with two clients where relevant.
- Every change goes on a branch and through a pull request. Never push to `main`.
- Conventional commits (`type(scope): subject`).
- No AI attribution in commits or pull requests: no `Co-Authored-By` trailers, no "Generated with" lines.
- Update the spec in the same pull request when implementation needs it to change.
