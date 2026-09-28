'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { PublishBar } from '@/components/cms/publish-bar';
import { Revisions } from '@/components/cms/revisions';
import { SeoFields } from '@/components/cms/seo-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { WORK_ART } from '@/lib/cms-display';
import { errorMessage } from '@/lib/convex-error';

// Writing a case study (13-cms-and-website.md). The shape follows the website's own: a line for the list, the story in
// three parts, and the screenshots. Saving writes a draft and leaves the website alone until somebody publishes.

type Work = Extract<NonNullable<typeof api.cms.get._returnType>, { art: string }>;

/** A list of short lines, which is what brief, hard part and built each are. */
function Lines({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-sm text-muted-foreground">{hint}</p>
      {value.map((line, index) => (
        <div key={index} className="flex gap-2">
          <Input
            value={line}
            aria-label={`${label} ${index + 1}`}
            onChange={(event) => onChange(value.map((item, at) => (at === index ? event.target.value : item)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${label} ${index + 1}`}
            onClick={() => onChange(value.filter((_, at) => at !== index))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ''])}>
        <Plus aria-hidden />
        Add a line
      </Button>
    </div>
  );
}

export function WorkEditor({ workId }: { workId: Id<'works'> }) {
  const work = useQuery(api.cms.get, { table: 'works', id: workId }) as Work | null | undefined;
  const update = useMutation(api.cms.updateWork);
  const recordPermission = useMutation(api.cms.recordClientPermission);
  const remove = useMutation(api.cmsPublish.remove);
  const router = useRouter();

  const [draft, setDraft] = useState<Work | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (work === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (work === null) return <p className="rounded-md border border-dashed p-6 text-muted-foreground">Not found.</p>;

  // The form holds its own copy while it is being edited, so a keystroke is not a write.
  const current = draft ?? work;
  const set = (changes: Partial<Work>) => setDraft({ ...current, ...changes });

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/cms/works">
            <ArrowLeft aria-hidden />
            Case studies
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{work.name || 'Untitled case study'}</h1>
        {work.projectId && (
          <p className="text-sm text-muted-foreground">
            Drafted from{' '}
            <Link href={`/projects/${work.projectId}`} className="underline-offset-4 hover:underline">
              the project
            </Link>
            .
          </p>
        )}
      </div>

      <PublishBar
        table="works"
        id={workId}
        label={work.name}
        status={work.status}
        unpublishedChanges={work.unpublishedChanges}
        blockers={work.blockers}
      />

      <section className="space-y-4">
        <h2 className="text-lg font-medium">The work</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="work-name">Name</Label>
            <Input id="work-name" value={current.name} onChange={(event) => set({ name: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="work-art">Artwork</Label>
            <NativeSelect id="work-art" value={current.art} onChange={(event) => set({ art: event.target.value })}>
              <option value="">Choose one</option>
              {WORK_ART.map((art) => (
                <option key={art} value={art}>
                  {art}
                </option>
              ))}
            </NativeSelect>
            {/* Said here rather than discovered: the list is drawn in the website's code, not stored as content. */}
            <p className="text-sm text-muted-foreground">
              These are the illustrations the website can draw. Adding another one is a change in the website’s code.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-list-line">Line for the list</Label>
          <Input
            id="work-list-line"
            value={current.listLine}
            onChange={(event) => set({ listLine: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-list-detail">Detail under it</Label>
          <Input
            id="work-list-detail"
            value={current.listDetail}
            onChange={(event) => set({ listDetail: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-summary">Summary</Label>
          <Textarea
            id="work-summary"
            rows={3}
            value={current.summary}
            onChange={(event) => set({ summary: event.target.value })}
          />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="work-client">Client</Label>
          <Input
            id="work-client"
            value={current.meta.client}
            onChange={(event) => set({ meta: { ...current.meta, client: event.target.value } })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-year">Year</Label>
          <Input
            id="work-year"
            value={current.meta.year}
            onChange={(event) => set({ meta: { ...current.meta, year: event.target.value } })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-role">What Unbuilt did</Label>
          <Input
            id="work-role"
            value={current.meta.role}
            onChange={(event) => set({ meta: { ...current.meta, role: event.target.value } })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-status">Where it stands</Label>
          <Input
            id="work-status"
            value={current.meta.status}
            onChange={(event) => set({ meta: { ...current.meta, status: event.target.value } })}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">The story</h2>
        <Lines
          label="The brief"
          hint="What the client came with."
          value={current.brief}
          onChange={(brief) => set({ brief })}
        />
        <Lines
          label="The hard part"
          hint="What made it difficult, in the client’s terms rather than ours."
          value={current.hardPart}
          onChange={(hardPart) => set({ hardPart })}
        />
        <Lines
          label="What was built"
          hint="What they have now."
          value={current.built}
          onChange={(built) => set({ built })}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Screenshots</h2>
        {current.shots.length === 0 ? (
          <p className="text-muted-foreground">None yet.</p>
        ) : (
          <ul className="space-y-3">
            {current.shots.map((shot, index) => (
              <li key={index} className="space-y-2 rounded-lg border p-3">
                <div className="space-y-2">
                  <Label htmlFor={`shot-alt-${index}`}>Alt text</Label>
                  <Input
                    id={`shot-alt-${index}`}
                    value={shot.alt}
                    onChange={(event) =>
                      set({
                        shots: current.shots.map((item, at) =>
                          at === index ? { ...item, alt: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  {/* Required to publish: a screenshot carries meaning, and not everybody can see it. */}
                  <p className="text-sm text-muted-foreground">
                    What the picture shows, for somebody who cannot see it. Needed before this can be published.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`shot-caption-${index}`}>Caption</Label>
                    <Input
                      id={`shot-caption-${index}`}
                      value={shot.caption}
                      onChange={(event) =>
                        set({
                          shots: current.shots.map((item, at) =>
                            at === index ? { ...item, caption: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`shot-frame-${index}`}>Frame</Label>
                    <NativeSelect
                      id={`shot-frame-${index}`}
                      value={shot.frame}
                      onChange={(event) =>
                        set({
                          shots: current.shots.map((item, at) =>
                            at === index
                              ? { ...item, frame: event.target.value as 'phone' | 'desktop' | 'wide' }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="phone">Phone</option>
                      <option value="desktop">Desktop</option>
                      <option value="wide">Wide</option>
                    </NativeSelect>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SeoFields seo={current.seo} slug={current.slug} onSeo={(seo) => set({ seo })} onSlug={(slug) => set({ slug })} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">The client’s permission</h2>
        {work.clientPermission ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4">
            <p className="text-sm">
              Recorded. {work.clientPermission.note ? `“${work.clientPermission.note}”` : 'No note.'}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void recordPermission({ workId, granted: false })}
            >
              Take it back
            </Button>
          </div>
        ) : (
          <PermissionForm workId={workId} />
        )}
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
                workId,
                slug: current.slug,
                name: current.name,
                art: current.art,
                listLine: current.listLine,
                listDetail: current.listDetail,
                seo: current.seo,
                summary: current.summary,
                meta: current.meta,
                stack: current.stack,
                link: current.link,
                brief: current.brief.filter((line) => line.trim()),
                hardPart: current.hardPart.filter((line) => line.trim()),
                built: current.built.filter((line) => line.trim()),
                results: current.results,
                shots: current.shots,
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
          title={`Delete ${work.name}?`}
          description="This removes the case study and everything written in it. If it is published, it comes off the website at the next build."
          confirmLabel="Delete it"
          onConfirm={async () => {
            await remove({ table: 'works', id: workId });
            router.push('/cms/works');
          }}
        />
      </div>

      <Revisions revisions={work.revisions} />
    </div>
  );
}

/** Recording that the client said yes, with who said it and when. */
function PermissionForm({ workId }: { workId: Id<'works'> }) {
  const record = useMutation(api.cms.recordClientPermission);
  const [note, setNote] = useState('');
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-4">
      <p className="text-sm text-muted-foreground">
        A case study is the client’s story as much as Unbuilt’s. It cannot be published until they have said yes.
      </p>
      <div className="space-y-2">
        <Label htmlFor="permission-note">How they said it</Label>
        <Input
          id="permission-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Said yes on a call, 12 October"
        />
      </div>
      <Button type="button" onClick={() => void record({ workId, granted: true, note: note.trim() || undefined })}>
        Record their permission
      </Button>
    </div>
  );
}
