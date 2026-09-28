import { z } from 'zod';

// The contract between the OS and the public website (13-cms-and-website.md, Content endpoint). The website copies
// these types and validates the response at build time, so a build with content it cannot read fails instead of
// deploying a broken site. Changing anything here is changing that contract: add fields, and make them optional.

const seo = z.object({ title: z.string(), description: z.string() });

/**
 * An image as the website receives it. `width` and `height` are optional because nothing captures them at upload yet —
 * the files table holds the bytes, their type and their hash, and no dimensions. Until it does, the website has to lay
 * images out without them.
 */
export const siteImage = z.object({
  url: z.string(),
  alt: z.string(),
  caption: z.string().optional(),
  frame: z.enum(['phone', 'desktop', 'wide']).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export const siteWork = z.object({
  slug: z.string(),
  name: z.string(),
  art: z.string(),
  listLine: z.string(),
  listDetail: z.string(),
  seo,
  summary: z.string(),
  meta: z.object({ client: z.string(), year: z.string(), role: z.string(), status: z.string() }),
  stack: z.array(z.string()),
  link: z.object({ href: z.string(), label: z.string() }).optional(),
  brief: z.array(z.string()),
  hardPart: z.array(z.string()),
  built: z.array(z.string()),
  results: z.array(z.string()).optional(),
  shots: z.array(siteImage),
  order: z.number(),
  publishedAt: z.number().optional(),
});

export const siteService = z.object({
  slug: z.string(),
  name: z.string(),
  short: z.string(),
  long: z.string(),
  stack: z.array(z.string()),
  deliverables: z.array(z.string()),
  seo,
  // Rich text blocks, whose shape the website's own renderer owns.
  body: z.array(z.unknown()),
  order: z.number(),
});

export const sitePost = z.object({
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  body: z.array(z.unknown()),
  cover: siteImage.optional(),
  authorName: z.string(),
  tags: z.array(z.string()),
  seo,
  publishedAt: z.number().optional(),
});

export const siteLegal = z.object({
  slug: z.string(),
  title: z.string(),
  intro: z.string(),
  sheet: z.string(),
  updatedDate: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.array(z.string()), list: z.array(z.string()).optional() })),
});

export const siteTestimonial = z.object({
  quote: z.string(),
  authorName: z.string(),
  authorRole: z.string(),
  /** The slug of the case study it belongs to, when it belongs to one. Ids never leave the OS. */
  workSlug: z.string().optional(),
});

export const siteSettingsContent = z.object({
  name: z.string(),
  url: z.string(),
  email: z.string(),
  phone: z.string(),
  socials: z.array(z.object({ name: z.string(), handle: z.string(), href: z.string() })),
  timeZone: z.string(),
  statusText: z.string(),
  seoDefaults: seo,
});

export const siteContent = z.object({
  works: z.array(siteWork),
  services: z.array(siteService),
  posts: z.array(sitePost),
  legal: z.array(siteLegal),
  testimonials: z.array(siteTestimonial),
  settings: siteSettingsContent,
  /** Changes whenever the content does, so a build can tell one snapshot from another. */
  version: z.string(),
  /** Present only on a preview response, naming what was included as a draft. */
  preview: z.object({ table: z.string(), slug: z.string() }).optional(),
});

export type SiteImage = z.infer<typeof siteImage>;
export type SiteWork = z.infer<typeof siteWork>;
export type SiteService = z.infer<typeof siteService>;
export type SitePost = z.infer<typeof sitePost>;
export type SiteLegal = z.infer<typeof siteLegal>;
export type SiteTestimonial = z.infer<typeof siteTestimonial>;
export type SiteSettingsContent = z.infer<typeof siteSettingsContent>;
export type SiteContent = z.infer<typeof siteContent>;
