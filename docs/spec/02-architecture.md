# 02 — Architecture

## Stack

| Layer           | Choice                                                                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | Node 24, pnpm 11                                                                                                                                                                             |
| Frontend        | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, shadcn/ui, lucide icons                                                                                                   |
| Forms           | react-hook-form with Zod schemas shared between client and Convex argument validation where practical                                                                                        |
| Tables          | TanStack Table                                                                                                                                                                               |
| Backend         | Convex: queries, mutations, actions, HTTP actions, scheduler, crons, file storage, search indexes                                                                                            |
| Convex packages | `convex-helpers` (custom functions, relationships), `@convex-dev/better-auth`, `@convex-dev/aggregate`, `@convex-dev/rate-limiter`, `@convex-dev/workpool` for outbound email and WhatsApp   |
| Auth            | Better Auth with the magic link and two-factor plugins, installed locally as a Convex component. Roles and principals live in app tables, so the organization and admin plugins are not used |
| PDF             | `@react-pdf/renderer` in `"use node"` actions                                                                                                                                                |
| Email           | Resend + React Email                                                                                                                                                                         |
| Payments        | Paystack REST API and webhooks                                                                                                                                                               |
| Messaging       | Meta WhatsApp Cloud API                                                                                                                                                                      |
| Calendar        | Google Calendar API (OAuth per team member)                                                                                                                                                  |
| Bot protection  | Cloudflare Turnstile on public forms                                                                                                                                                         |
| Monitoring      | Sentry for Next.js; Convex log streams or exception reporting as the Convex plan allows                                                                                                      |
| Testing         | Vitest + `convex-test` for backend, Vitest + Testing Library for components, Playwright end to end                                                                                           |
| Hosting         | Vercel (Next.js), Convex cloud                                                                                                                                                               |

## Repo layout

```text
unbuilt-os/
  app/
    (team)/            team app routes, served on os.unbuilt.studio
    portal/            client portal routes, served on portal.unbuilt.studio through a rewrite
    (auth)/            sign-in, 2FA verification and team 2FA setup
    api/auth/          proxy to Better Auth in Convex, so cookies stay on the app's own hosts
    sign/[token]/      public signing ceremony (token-gated, no session required)
    pay/[token]/       public invoice view and pay page (token-gated)
  components/
    ui/                shadcn/ui primitives
    app/               shared app components (data table, money input, status badge, command palette)
    <module>/          module-specific components
  convex/
    schema.ts
    convex.config.ts   components
    auth.config.ts     JWT provider for Better Auth
    auth.ts            Better Auth options and createAuth
    authFlows.ts       internal functions the sign-in hooks call
    principals.ts      principal lookup for teamAction
    roles.ts           role management
    betterAuth/        Better Auth component: generated schema (`pnpm auth:schema`) and adapter
    http.ts            HTTP router: webhooks and public endpoints
    crons.ts
    lib/
      functions.ts     teamQuery, teamMutation, teamAction, portalQuery, portalMutation, sessionQuery, internal helpers
      permissions.ts   permission keys, default roles, checks
      principals.ts    session and principal resolution, session revocation
      audit.ts         audited database writer, sensitive-field redaction
      authPlugins.ts   two-factor after magic link, second-factor rules per surface
      authEmails.ts    sign-in emails
      money.ts         minor units, rounding, currency formatting, totals
      numbering.ts     document number counters
      businessTime.ts  business hours and holiday arithmetic
      crypto.ts        vault encryption (Node)
      files.ts         upload and signed URL helpers
    crm/  projects/  documents/  billing/  support/  vault/  team/  portal/  cms/
    notifications/  search/  reports/  integrations/  imports/  privacy/  settings/
  emails/              React Email templates
  pdf/                 react-pdf document templates
  lib/                 client-side utilities
  public/brand/        mark and wordmark SVGs from the brand kit
  tests/e2e/           Playwright
  docs/spec/           this specification
  proxy.ts             hostname routing
  CLAUDE.md
```

## Hostname routing

`proxy.ts` inspects the host:

`lib/surface.ts` holds the rules; `proxy.ts` applies them.

- `os.unbuilt.studio` (and `localhost:3000` in dev, `unbuilt-os-pr-<n>.vercel.app` on previews) serves `(team)` and
  `(auth)`. `/portal` returns 404 there.
- `portal.unbuilt.studio` (and `portal.localhost:3000` in dev, `unbuilt-os-portal-pr-<n>.vercel.app` on previews) rewrites
  every path into `app/portal/`, so team paths resolve to nothing and return 404. Portal pages use a real `portal/`
  segment rather than a route group because both surfaces need their own `/`.
- `/sign-in`, `/api/auth`, `sign/[token]` and `pay/[token]` are reachable on both hosts without a session.
- Other paths without a session cookie redirect to `/sign-in?callbackURL=...`. This is an optimistic check; layouts and
  Convex functions verify the session.

Hostname routing is a convenience, not a security boundary. Every Convex function enforces identity and
permissions itself (see `03-auth-and-permissions.md`).

## Environments

| Environment | Convex                                                                                          | Vercel                                       | Integrations                                                 |
| ----------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| Development | Personal dev deployment per developer                                                           | `pnpm dev`                                   | Paystack test keys, Resend test domain, WhatsApp test number |
| Preview     | Convex preview deployment per PR if the plan supports it, otherwise a shared staging deployment | Vercel preview per PR                        | Test keys only                                               |
| Production  | Production deployment                                                                           | `os.unbuilt.studio`, `portal.unbuilt.studio` | Live keys                                                    |

Convex environment variables, set per deployment and never committed:

| Variable             | Purpose                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | Signs cookies and encrypts two-factor secrets. Different on every deployment              |
| `AUTH_ALLOWED_HOSTS` | Hostnames the app is served on, comma-separated, wildcards allowed. Defaults to localhost |
| `RESEND_API_KEY`     | Sending-only Resend key. Separate keys per environment                                    |
| `AUTH_EMAIL_FROM`    | Sender for sign-in emails. Defaults to Resend's test sender until the domain is verified  |

Staging allows `unbuilt-os-pr-*.vercel.app`; production allows `os.unbuilt.studio`, `portal.unbuilt.studio` and
`unbuilt-os.vercel.app`.

Seed script (`convex/seed.ts`, internal mutation) creates default roles, permission sets, an owner invite, Nigerian
public holidays for the current and next year, default SLA policies, document templates, and sample data in
development only. Seeding must be idempotent.

## CI/CD

Mirror the website repo (`madebyunbuilt/unbuilt-studio-web`):

- `.github/workflows/ci-cd.yml` named "CI/CD".
- Jobs: `check` (typecheck, ESLint, Prettier, unit and Convex tests, build), `commitlint` on PRs, `e2e` (Playwright
  against a preview), `preview` deploy on PRs with a sticky PR comment, `production` deploy on push to `main`.
- Deploy jobs `needs: check`. Production deploys never cancel mid-run.
- Convex deploys with `pnpm convex deploy` using `CONVEX_DEPLOY_KEY`, before the Vercel deploy, in the same job.
- Use current major versions of actions (`actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`,
  `actions/github-script@v9` at the time of writing). Pin the Vercel CLI version.

## Conventions

- pnpm only. Never npm or npx; use `pnpm dlx` for one-off tools.
- Husky: pre-commit runs lint-staged, commit-msg runs commitlint, pre-push runs typecheck and lint.
- Conventional commits: `type(scope): subject`. Types: feat fix perf refactor style content docs test build ci chore revert.
- Every change goes through a branch and a pull request. Never push to `main`. Several related commits on one branch
  are fine.
- No AI attribution anywhere: no `Co-Authored-By` trailers, no "Generated with" lines in commits or PR descriptions.
- Prettier: single quotes, 120 columns, trailing commas.
- ESLint: `eslint-config-next` core-web-vitals and TypeScript, plus `consistent-type-imports`, `eqeqeq`, no `console.log`.
- Convex: never export a raw `query`, `mutation` or `action` from a module file. Use the wrappers in
  `convex/lib/functions.ts`. A test fails the build if a raw export is found.
- All money as integer minor units with a currency code (see `04-data-model.md`).
- All timestamps as UTC epoch milliseconds. Display in the viewer's timezone; business rules use the studio timezone
  `Africa/Lagos` unless a client record says otherwise.

## Testing requirements

- **Permissions**: for every exported team and portal function, a test proves an unauthorised caller is rejected and an
  authorised one succeeds. Portal tests prove a client can never read another client's data.
- **Money**: unit tests for totals, discounts, VAT, WHT, rounding, partial payments, credit notes and FX conversion.
- **Business time**: SLA timers across weekends, holidays, timezone boundaries and daylight-saving-free zones.
- **Numbering**: concurrent creation never produces duplicate document numbers.
- **E-signature**: the signed PDF hash matches the stored hash; any change to a signed document is rejected.
- **Webhooks**: signature verification, idempotency (the same event processed twice changes nothing), and out-of-order delivery.
- **End to end**: the flows in `16-key-flows.md`.
