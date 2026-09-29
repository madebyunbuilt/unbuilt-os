'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { PublishBar } from '@/components/cms/publish-bar';
import { Revisions } from '@/components/cms/revisions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

// A legal page (13-cms-and-website.md). These are also what the portal asks a client to accept, so the date it was
// last changed is part of the page rather than a detail: a client accepted a particular version on a particular day.

type Legal = Extract<NonNullable<typeof api.cms.get._returnType>, { intro: string }>;
type Section = { heading: string; body: string[]; list?: string[] };

export function LegalEditor({ legalPageId }: { legalPageId: Id<'legalPages'> }) {
  const page = useQuery(api.cms.get, { table: 'legalPages', id: legalPageId }) as Legal | null | undefined;
  const update = useMutation(api.cms.updateLegalPage);
  const remove = useMutation(api.cmsPublish.remove);
  const router = useRouter();

  const [draft, setDraft] = useState<Legal | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (page === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (page === null) return <p className="rounded-md border border-dashed p-6 text-muted-foreground">Not found.</p>;

  const current = draft ?? page;
  const set = (changes: Partial<Legal>) => setDraft({ ...current, ...changes });
  const sections = current.sections as Section[];
  const setSection = (index: number, changes: Partial<Section>) =>
    set({ sections: sections.map((section, at) => (at === index ? { ...section, ...changes } : section)) as never });

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/cms/legal">
            <ArrowLeft aria-hidden />
            Legal pages
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{page.title || 'Untitled'}</h1>
      </div>

      <PublishBar
        table="legalPages"
        id={legalPageId}
        label={page.title}
        status={page.status}
        unpublishedChanges={page.unpublishedChanges}
        blockers={page.blockers}
      />

      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="legal-title">Title</Label>
            <Input id="legal-title" value={current.title} onChange={(event) => set({ title: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="legal-slug">Address</Label>
            <Input id="legal-slug" value={current.slug} onChange={(event) => set({ slug: event.target.value })} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="legal-sheet">Short name</Label>
            <Input id="legal-sheet" value={current.sheet} onChange={(event) => set({ sheet: event.target.value })} />
            <p className="text-sm text-muted-foreground">How it is referred to in a list or a link.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="legal-updated">Last changed</Label>
            <Input
              id="legal-updated"
              type="date"
              value={current.updatedDate}
              onChange={(event) => set({ updatedDate: event.target.value })}
            />
            {/* Shown on the page and recorded when a client accepts, so it is set deliberately rather than inferred. */}
            <p className="text-sm text-muted-foreground">
              Shown on the page. Clients accept a particular version, so change this when the wording changes.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="legal-intro">Opening</Label>
          <Textarea
            id="legal-intro"
            rows={3}
            value={current.intro}
            onChange={(event) => set({ intro: event.target.value })}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Sections</h2>
        {sections.map((section, index) => (
          <div key={index} className="space-y-3 rounded-lg border p-4">
            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor={`section-heading-${index}`}>Heading</Label>
                <Input
                  id={`section-heading-${index}`}
                  value={section.heading}
                  onChange={(event) => setSection(index, { heading: event.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-7"
                aria-label={`Remove section ${index + 1}`}
                onClick={() => set({ sections: sections.filter((_, at) => at !== index) as never })}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`section-body-${index}`}>Text</Label>
              <Textarea
                id={`section-body-${index}`}
                rows={4}
                value={section.body.join('\n\n')}
                onChange={(event) =>
                  setSection(index, {
                    body: event.target.value
                      .split(/\n{2,}/)
                      .map((part) => part.trim())
                      .filter(Boolean),
                  })
                }
              />
              <p className="text-sm text-muted-foreground">A blank line starts a new paragraph.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`section-list-${index}`}>Bullet points</Label>
              <Textarea
                id={`section-list-${index}`}
                rows={3}
                value={(section.list ?? []).join('\n')}
                onChange={(event) => {
                  const list = event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean);
                  setSection(index, { list: list.length > 0 ? list : undefined });
                }}
              />
              <p className="text-sm text-muted-foreground">One per line. Leave empty for none.</p>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => set({ sections: [...sections, { heading: '', body: [] }] as never })}
        >
          <Plus aria-hidden />
          Add a section
        </Button>
      </section>

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
                legalPageId,
                slug: current.slug,
                title: current.title,
                intro: current.intro,
                sheet: current.sheet,
                updatedDate: current.updatedDate,
                sections: current.sections,
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
          title={`Delete ${page.title}?`}
          description="This removes the page. If it is published, it comes off the website at the next build."
          confirmLabel="Delete it"
          onConfirm={async () => {
            await remove({ table: 'legalPages', id: legalPageId });
            router.push('/cms/legal');
          }}
        />
      </div>

      <Revisions revisions={page.revisions} />
    </div>
  );
}
