'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { counter, SEO_DESCRIPTION_MAX, SEO_DESCRIPTION_MIN, SEO_TITLE_MAX } from '@/lib/cms-display';

// The fields that decide how a page reads in a search result (13, Editing). The counts are live because the limits are
// the website's, not preferences: past them the text is cut off by the search engine rather than by us.

function Count({ value, min, max }: { value: string; min: number | null; max: number }) {
  const { text, tone } = counter(value, min, max);
  return (
    <span aria-live="polite" className={tone === 'warn' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
      {text}
    </span>
  );
}

export function SeoFields({
  seo,
  slug,
  onSeo,
  onSlug,
  slugHint,
}: {
  seo: { title: string; description: string };
  slug: string;
  onSeo: (next: { title: string; description: string }) => void;
  onSlug: (next: string) => void;
  slugHint?: string;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">How it reads in search</h2>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="seo-title">Title</Label>
          <Count value={seo.title} min={null} max={SEO_TITLE_MAX} />
        </div>
        <Input id="seo-title" value={seo.title} onChange={(event) => onSeo({ ...seo, title: event.target.value })} />
        <p className="text-sm text-muted-foreground">
          The website adds “ | Unbuilt Studio”, so anything past {SEO_TITLE_MAX} characters is cut off in a result.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="seo-description">Description</Label>
          <Count value={seo.description} min={SEO_DESCRIPTION_MIN} max={SEO_DESCRIPTION_MAX} />
        </div>
        <Textarea
          id="seo-description"
          rows={3}
          value={seo.description}
          onChange={(event) => onSeo({ ...seo, description: event.target.value })}
        />
        <p className="text-sm text-muted-foreground">
          Between {SEO_DESCRIPTION_MIN} and {SEO_DESCRIPTION_MAX} characters. Shorter gets padded by the search engine;
          longer gets cut.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="seo-slug">Address</Label>
        <Input id="seo-slug" value={slug} onChange={(event) => onSlug(event.target.value)} />
        <p className="text-sm text-muted-foreground">
          {slugHint ?? 'Lowercase words and numbers, separated by hyphens.'} Changing it changes the page’s address, and
          anybody who linked to the old one will find nothing.
        </p>
      </div>
    </section>
  );
}
