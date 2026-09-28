# 13 — CMS and the public website

The public website (`madebyunbuilt/unbuilt-studio-web`, Next.js 16, deployed to `unbuilt.studio`) currently reads its
content from `content/projects.ts`, `content/services.ts`, `content/legal.ts` and `content/site.ts`. The OS becomes the
source of that content. The website stays fully static and fast: it fetches published content **at build time only**
and rebuilds when content is published.

## Content types

| Type          | Website use                                                              | Shape                                                       |
| ------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Works         | `/work` list, `/work/[slug]` case studies, home "Things we've built"     | Mirrors the website `Project` type (see `04-data-model.md`) |
| Service pages | `/services` list, and one landing page per service at `/services/[slug]` | Mirrors `Service` plus SEO fields and a rich body           |
| Insights      | `/insights` and `/insights/[slug]` articles                              | Posts with SEO fields                                       |
| Legal pages   | `/legal/[slug]`, and the portal's privacy notice and terms               | Mirrors `LegalDoc`                                          |
| Testimonials  | Case studies and the home page                                           | Quote, author, role, client, work                           |
| Site settings | Email, phone, socials, status text, SEO defaults                         | Mirrors `site` plus status and SEO                          |

The website changes required to consume this (new routes for service pages and insights, and replacing the content
files) are a separate PR in the website repo, described below.

## Editing

- `cms.edit` edits drafts; `cms.publish` publishes.
- Every save writes a `contentRevisions` snapshot; any revision can be restored as a new draft.
- Editing never changes what the website is served. Each item keeps its working copy in its own fields and the published
  copy in `published`, which only publishing writes. So a live page can be edited, or an old revision restored onto it,
  and the website goes on serving what was last published until somebody publishes again.
- **SEO fields are required to publish**: title under 44 characters (the website appends " | Unbuilt Studio"), description
  of 140 to 160 characters, a slug of lowercase words and hyphens. Show live character counts.
- **Images**: uploaded to Convex storage, with alt text required. Case study shots keep the `frame` option (phone,
  desktop, wide). Warn when an image is over 500 KB, and reject over 5 MB.
- **Works `art`** is a fixed list of the variants drawn in the website's code (`glossup`, `qravit`, `orrery`, `commit`,
  `pr`). Adding a variant requires a website code change, so the CMS shows the list and explains that.
- **Preview**: drafts are viewable on the website's preview deployment through a signed preview token (see Website
  integration).
- **Scheduled publishing** for insights: `publishAt` publishes via the scheduler.

## From project to case study

- When a project's handover completes, create a draft work. It can also be drafted by hand from the project, which is
  what happens today: handover lands in step 15, and `caseStudy.draftOnHandover` is what it will call. Drafting twice
  hands back the draft that exists rather than making a second, so a handover reopened and completed again is safe.
- Pre-filled with:
  - name, client and year
  - role (from project members)
  - stack (from project type and links)
  - summary (from the SOW's scope)
  - screenshots (from the final deliverable versions)
  - `projectId` link
- What it fills in is what the OS already knows and nobody should retype. What it leaves empty is what only a writer
  can supply: the hook, the brief, the hard part, the SEO, image alt text, and the artwork — which is one of a fixed set
  the website can draw, so guessing one would be a guess. Each of those blocks publishing until it is filled in, so an
  empty field reads as an invitation to write rather than as finished work.
- Screenshots come from the version the client **approved**, not whatever was uploaded last, and images only.
- The summary comes from a SOW that was actually sent. A draft SOW is what somebody was thinking; a sent one is what the
  client agreed to.
- The case study stays a draft until the client's permission to publish is recorded (checkbox with date and contact).
  Publishing without it is blocked.
- Taking that permission back takes a published case study **off the website**, and asks for the rebuild that removes
  it. The same holds for a testimonial whose approval is withdrawn. Leaving it up would mean the client has said no and
  the site still says yes, with nothing on screen admitting it. The screen says so before it happens, because approval
  and publication being linked is not obvious.

## Publishing

- Publishing sets `status = published` and `publishedAt`, then schedules a deploy.
- **Debounce**: publishes within 60 seconds are batched into one deploy by scheduling the deploy action 60 seconds after
  the first publish and skipping if one is already pending.
- The deploy action calls the website's Vercel Deploy Hook URL (Convex env `WEBSITE_DEPLOY_HOOK_URL`) and records a
  `publishes` row. The website's own CI/CD pipeline is not involved in content-only deploys.
- **Unpublish** and **delete** also schedule a deploy. Deleting a published work that other works reference (for example
  as the "next project") is blocked until references change.

## Website integration

### Content endpoint

`GET /public/site-content` (Convex HTTP action):

- Requires `Authorization: Bearer <WEBSITE_CONTENT_TOKEN>`, a secret shared with the website's build environment. It is
  read-only and returns published content only.
- Returns one JSON document:
  - `works`, `services`, `posts`, `legal`, `testimonials`, `settings`
  - image URLs resolved to Convex storage URLs, with width and height when known. Dimensions are read from the image's
    header after an upload is recorded (`convex/lib/imageSize.ts`, PNG, JPEG, GIF and WebP), which is its own scheduled
    step because a mutation cannot read the bytes. An image whose header cannot be read keeps no dimensions and is
    otherwise untouched: losing an upload over a header would be the worse outcome. SVG is not attempted, because it
    often has no pixel size and a guess from a viewBox would be worse than saying nothing.
  - a `version` hash
- `?preview=<signed token>` includes drafts for one item, used by the website's preview deployment. Preview tokens are
  HMAC-signed, expire in 1 hour, and are generated by `cms.view` holders. They are signed with a key derived from
  `WEBSITE_CONTENT_TOKEN` under a fixed label rather than a secret of their own: one fewer thing to set on a deployment,
  and the label keeps the two uses apart, so neither token can stand in for the other.
- A preview token that has expired, been tampered with, or names something that is gone is **ignored, not refused**: a
  build asking for a preview it cannot have should still get the live site. The published answer may be cached; a
  preview answer never is.
- Content that does not match the schema is answered as a 500 **saying so**. The caller is the website's own build
  holding the shared token, and a build that fails saying "content does not match the schema" is one somebody can fix.
- Types are published as a Zod schema in `convex/cms/siteContentSchema.ts`. The website copies the generated TypeScript
  types (or imports them from a small shared package if one is created later) and validates the response at build time.
  A build with invalid content fails instead of deploying a broken site.

### Website changes (separate PR in the website repo)

1. Replace `content/projects.ts`, `services.ts`, `legal.ts` and `site.ts` with a build-time loader that fetches
   `/public/site-content` once per build, validates it with the schema, and caches it for the build.
2. Keep all pages static (`generateStaticParams` from the fetched slugs).
3. Add `/services/[slug]` landing pages and `/insights` + `/insights/[slug]`, with `pageMetadata()`, structured data and
   sitemap entries, following the website's existing SEO setup.
4. Allow Convex storage image hosts in `next.config.ts` `images.remotePatterns`.
5. Keep a committed fallback snapshot of the last good content so local development works without the token.

### Enquiries

`POST /public/enquiries` (Convex HTTP action):

- CORS allows only the origins in `ENQUIRY_ALLOWED_ORIGINS`: `https://unbuilt.studio` and the website's preview domains.
- Body: the enquiry sheet fields plus `turnstileToken`.
- Verifies Turnstile server-side, rate-limits (5 per hour per IP, 3 per day per email), validates with Zod, stores the
  enquiry, schedules notifications, and returns `{ ok: true }` with no internal ids.
- The website's `EnquirySheet` posts here and keeps its current mailto and copy-the-brief fallbacks when the request fails.

## Acceptance criteria

- Publishing is blocked when SEO title, description, slug or any image alt text is missing or out of range.
- Several publishes within 60 seconds call the deploy hook exactly once.
- `/public/site-content` rejects requests without the token, never returns drafts without a valid preview token, and its
  output validates against the schema.
- A draft case study created from a project cannot be published until client permission is recorded.
- Restoring a revision creates a new draft and does not alter the published version until published.
- The enquiry endpoint rejects invalid Turnstile tokens, disallowed origins and rate-limited callers.
