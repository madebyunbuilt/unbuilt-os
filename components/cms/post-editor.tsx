'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, CalendarClock, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { BodyField } from '@/components/cms/body-field';
import { ImagePicker } from '@/components/cms/image-picker';
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
import { formatMoment } from '@/lib/support-display';

// Writing an insight (13-cms-and-website.md). The one thing here that no other type has: it can be given a date and
// publish itself, which is why the date is offered next to Publish rather than buried in the form.

type Post = Extract<NonNullable<typeof api.cms.get._returnType>, { excerpt: string }>;

export function PostEditor({ postId }: { postId: Id<'posts'> }) {
  const post = useQuery(api.cms.get, { table: 'posts', id: postId }) as Post | null | undefined;
  const update = useMutation(api.cms.updatePost);
  const remove = useMutation(api.cmsPublish.remove);
  const router = useRouter();

  const [draft, setDraft] = useState<Post | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (post === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (post === null) return <p className="rounded-md border border-dashed p-6 text-muted-foreground">Not found.</p>;

  const current = draft ?? post;
  const set = (changes: Partial<Post>) => setDraft({ ...current, ...changes });

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/cms/insights">
            <ArrowLeft aria-hidden />
            Insights
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{post.title || 'Untitled'}</h1>
      </div>

      <PublishBar
        table="posts"
        id={postId}
        label={post.title}
        status={post.status}
        unpublishedChanges={post.unpublishedChanges}
        blockers={post.blockers}
      />

      <Scheduling postId={postId} status={post.status} publishAt={post.publishAt} blocked={post.blockers.length > 0} />

      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="post-title">Title</Label>
          <Input id="post-title" value={current.title} onChange={(event) => set({ title: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="post-excerpt">Excerpt</Label>
          <Textarea
            id="post-excerpt"
            rows={2}
            value={current.excerpt}
            onChange={(event) => set({ excerpt: event.target.value })}
          />
          <p className="text-sm text-muted-foreground">The line under the title on the insights list.</p>
        </div>
        <div className="space-y-2">
          <Label>Cover image</Label>
          <CoverImage fileId={current.coverFileId} />
          <ImagePicker
            table="posts"
            id={postId}
            label={current.coverFileId ? 'Change the cover' : 'Add a cover'}
            onPicked={({ fileId }) => set({ coverFileId: fileId })}
          />
          {current.coverFileId && (
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ coverFileId: undefined })}>
              Remove the cover
            </Button>
          )}
          {/* The alt text is the title: a cover illustrates the article rather than saying something of its own. */}
          <p className="text-sm text-muted-foreground">
            Shown on the insights list and at the top of the article. Its alt text is the title.
          </p>
        </div>
        <BodyField
          id="post-body"
          label="The article"
          value={current.body as Block[]}
          onChange={(body) => set({ body })}
        />
        <div className="space-y-2">
          <Label htmlFor="post-tags">Tags</Label>
          <Input
            id="post-tags"
            value={current.tags.join(', ')}
            onChange={(event) =>
              set({
                tags: event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
          />
          <p className="text-sm text-muted-foreground">Separated by commas.</p>
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
                postId,
                slug: current.slug,
                authorMemberId: current.authorMemberId,
                title: current.title,
                excerpt: current.excerpt,
                body: current.body,
                coverFileId: current.coverFileId,
                tags: current.tags,
                seo: current.seo,
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
          title={`Delete ${post.title}?`}
          description="This removes the article and everything written in it. If it is published, it comes off the website at the next build."
          confirmLabel="Delete it"
          onConfirm={async () => {
            await remove({ table: 'posts', id: postId });
            router.push('/cms/insights');
          }}
        />
      </div>

      <Revisions revisions={post.revisions} />
    </div>
  );
}

/** Giving an insight a date to publish itself on, and taking it back. */
function Scheduling({
  postId,
  status,
  publishAt,
  blocked,
}: {
  postId: Id<'posts'>;
  status: string;
  publishAt?: number;
  blocked: boolean;
}) {
  const schedule = useMutation(api.cmsPublish.schedulePost);
  const unschedule = useMutation(api.cmsPublish.unschedulePost);
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (status === 'published') return null;

  if (status === 'scheduled') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4">
        <p className="text-sm">
          <CalendarClock aria-hidden className="mr-2 inline size-4 text-muted-foreground" />
          Goes out on its own {publishAt ? formatMoment(publishAt) : 'on its date'}. It can still be edited until then.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void unschedule({ postId })}>
          Cancel that
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-4">
      <Label htmlFor="post-schedule">Publish it later</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="post-schedule"
          type="datetime-local"
          className="max-w-60"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!when || blocked}
          onClick={async () => {
            setError(null);
            try {
              await schedule({ postId, publishAt: new Date(when).getTime() });
            } catch (caught) {
              setError(errorMessage(caught));
            }
          }}
        >
          Schedule
        </Button>
      </div>
      {/* Checked now as well as at the time, so nothing is scheduled only to fail quietly at midnight. */}
      <p className="text-sm text-muted-foreground">
        {blocked
          ? 'Everything above has to be filled in before this can be scheduled.'
          : 'It publishes itself then, and asks for a rebuild at the same time.'}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** The cover as it stands, so somebody can see what they are replacing. */
function CoverImage({ fileId }: { fileId?: Id<'files'> }) {
  const urls = useQuery(api.cms.imageUrls, fileId ? { fileIds: [fileId] } : 'skip');
  const url = fileId ? urls?.[fileId] : undefined;
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-32 w-full max-w-sm rounded object-cover" />;
}
