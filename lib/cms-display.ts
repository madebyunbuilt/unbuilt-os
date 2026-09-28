// How the CMS reads on screen (13-cms-and-website.md).

export const CONTENT_TABLES = ['works', 'servicePages', 'posts', 'legalPages', 'testimonials'] as const;
export type ContentTable = (typeof CONTENT_TABLES)[number];

export const CONTENT_LABELS: Record<ContentTable, { one: string; many: string; segment: string; blurb: string }> = {
  works: {
    one: 'Case study',
    many: 'Case studies',
    segment: 'works',
    blurb: 'The work on /work, and the ones on the home page.',
  },
  servicePages: {
    one: 'Service page',
    many: 'Service pages',
    segment: 'services',
    blurb: 'One landing page per service.',
  },
  posts: { one: 'Insight', many: 'Insights', segment: 'insights', blurb: 'Articles on /insights.' },
  legalPages: {
    one: 'Legal page',
    many: 'Legal pages',
    segment: 'legal',
    blurb: 'Privacy, terms, and what the portal asks clients to accept.',
  },
  testimonials: {
    one: 'Testimonial',
    many: 'Testimonials',
    segment: 'testimonials',
    blurb: 'Quotes on case studies and the home page.',
  },
};

export const SEO_TITLE_MAX = 44;
export const SEO_DESCRIPTION_MIN = 140;
export const SEO_DESCRIPTION_MAX = 160;

/** The artwork variants the website's own code can draw. Adding one needs a change in the website repo. */
export const WORK_ART = ['glossup', 'qravit', 'orrery', 'commit', 'pr'] as const;

export function statusLabel(status: string): string {
  if (status === 'published') return 'Published';
  if (status === 'scheduled') return 'Scheduled';
  return 'Draft';
}

/** A count that says how it stands against the limit, for a field the website will cut off. */
export function counter(value: string, min: number | null, max: number): { text: string; tone: 'ok' | 'warn' } {
  const length = value.trim().length;
  if (length === 0) return { text: `0 of ${max}`, tone: 'warn' };
  if (length > max) return { text: `${length} of ${max} — too long`, tone: 'warn' };
  if (min !== null && length < min) return { text: `${length}, needs ${min}`, tone: 'warn' };
  return { text: `${length} of ${max}`, tone: 'ok' };
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
