'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { BodyField } from '@/components/cms/body-field';
import { PublishBar } from '@/components/cms/publish-bar';
import { Revisions } from '@/components/cms/revisions';
import { SeoFields } from '@/components/cms/seo-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Block } from '@/lib/cms-blocks';
import { errorMessage } from '@/lib/convex-error';

// A service's landing page (13-cms-and-website.md). Short is what appears in the list; long is what opens the page.

type Service = Extract<NonNullable<typeof api.cms.get._returnType>, { deliverables: string[] }>;

export function ServiceEditor({ servicePageId }: { servicePageId: Id<'servicePages'> }) {
  const page = useQuery(api.cms.get, { table: 'servicePages', id: servicePageId }) as Service | null | undefined;
  const update = useMutation(api.cms.updateServicePage);
  const remove = useMutation(api.cmsPublish.remove);
  const router = useRouter();

  const [draft, setDraft] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (page === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (page === null) return <p className="rounded-md border border-dashed p-6 text-muted-foreground">Not found.</p>;

  const current = draft ?? page;
  const set = (changes: Partial<Service>) => setDraft({ ...current, ...changes });
  const list = (value: string) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/cms/services">
            <ArrowLeft aria-hidden />
            Service pages
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{page.name || 'Untitled service'}</h1>
      </div>

      <PublishBar
        table="servicePages"
        id={servicePageId}
        label={page.name}
        status={page.status}
        unpublishedChanges={page.unpublishedChanges}
        blockers={page.blockers}
      />

      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="service-name">Name</Label>
          <Input id="service-name" value={current.name} onChange={(event) => set({ name: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="service-short">Short</Label>
          <Input id="service-short" value={current.short} onChange={(event) => set({ short: event.target.value })} />
          <p className="text-sm text-muted-foreground">One line, on the services list.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="service-long">Long</Label>
          <Textarea
            id="service-long"
            rows={3}
            value={current.long}
            onChange={(event) => set({ long: event.target.value })}
          />
          <p className="text-sm text-muted-foreground">The paragraph that opens the page.</p>
        </div>
        <BodyField
          id="service-body"
          label="The page"
          value={current.body as Block[]}
          onChange={(body) => set({ body })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="service-stack">What it is built with</Label>
            <Textarea
              id="service-stack"
              rows={4}
              value={current.stack.join('\n')}
              onChange={(event) => set({ stack: list(event.target.value) })}
            />
            <p className="text-sm text-muted-foreground">One per line.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-deliverables">What the client gets</Label>
            <Textarea
              id="service-deliverables"
              rows={4}
              value={current.deliverables.join('\n')}
              onChange={(event) => set({ deliverables: list(event.target.value) })}
            />
            <p className="text-sm text-muted-foreground">One per line.</p>
          </div>
        </div>
      </section>

      <SeoFields seo={current.seo} slug={current.slug} onSeo={(seo) => set({ seo })} onSlug={(slug) => set({ slug })} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2 border-t pt-6">
        <Button
          type="button"
          disabled={saving || draft === null}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await update({
                servicePageId,
                slug: current.slug,
                name: current.name,
                short: current.short,
                long: current.long,
                stack: current.stack,
                deliverables: current.deliverables,
                seo: current.seo,
                body: current.body,
              });
              setDraft(null);
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Save aria-hidden />
          {saving ? 'Saving…' : draft === null ? 'Saved' : 'Save'}
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="destructive">
              <Trash2 aria-hidden />
              Delete
            </Button>
          }
          title={`Delete ${page.name}?`}
          description="This removes the page. If it is published, it comes off the website at the next build."
          confirmLabel="Delete it"
          onConfirm={async () => {
            await remove({ table: 'servicePages', id: servicePageId });
            router.push('/cms/services');
          }}
        />
      </div>

      <Revisions revisions={page.revisions} />
    </div>
  );
}
