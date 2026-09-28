'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { statusLabel } from '@/lib/cms-display';

// Quotes (13-cms-and-website.md). Short enough that a list of them is the whole screen: each row is the quote, who
// said it, and whether the client has approved it going on the website.

type Testimonial = { id: string; label: string; status: string; unpublishedChanges: boolean };

function TestimonialForm({ trigger }: { trigger: React.ReactNode }) {
  const create = useMutation(api.cms.createTestimonial);
  const works = useQuery(api.cms.list, { table: 'works' });
  const [quote, setQuote] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [authorRole, setAuthorRole] = useState('');
  const [workId, setWorkId] = useState('');

  return (
    <FormDialog
      trigger={trigger}
      title="Add a quote"
      description="It cannot be published until the client has approved it going on the website."
      submitLabel="Add it"
      canSubmit={quote.trim().length > 0 && authorName.trim().length > 0}
      onSubmit={async () => {
        await create({
          quote,
          authorName,
          authorRole,
          workId: workId ? (workId as Id<'works'>) : undefined,
        });
        setQuote('');
        setAuthorName('');
        setAuthorRole('');
        setWorkId('');
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="quote">What they said</Label>
        <Textarea id="quote" rows={3} value={quote} onChange={(event) => setQuote(event.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="quote-author">Who said it</Label>
          <Input id="quote-author" value={authorName} onChange={(event) => setAuthorName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quote-role">Their role</Label>
          <Input id="quote-role" value={authorRole} onChange={(event) => setAuthorRole(event.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="quote-work">About which case study</Label>
        <NativeSelect id="quote-work" value={workId} onChange={(event) => setWorkId(event.target.value)}>
          <option value="">Not about one in particular</option>
          {(works ?? []).map((work) => (
            <option key={work.id} value={work.id}>
              {work.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </FormDialog>
  );
}

export function Testimonials() {
  const rows = useQuery(api.cms.list, { table: 'testimonials' }) as Testimonial[] | undefined;
  const publish = useMutation(api.cmsPublish.publish);
  const unpublish = useMutation(api.cmsPublish.unpublish);
  const remove = useMutation(api.cmsPublish.remove);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <TestimonialForm
          trigger={
            <Button>
              <Plus aria-hidden />
              Add a quote
            </Button>
          }
        />
      </div>
      {rows === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">No quotes yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 font-medium">{row.label}</p>
                <Badge variant={row.status === 'published' ? 'default' : 'outline'}>{statusLabel(row.status)}</Badge>
              </div>
              <Approval id={row.id} />
              <div className="flex flex-wrap gap-2">
                {row.status === 'published' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void unpublish({ table: 'testimonials', id: row.id })}
                  >
                    Take it down
                  </Button>
                ) : (
                  <PublishQuote id={row.id} publish={publish} />
                )}
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm">
                      Delete
                    </Button>
                  }
                  title="Delete this quote?"
                  description="If it is published, it comes off the website at the next build."
                  confirmLabel="Delete it"
                  onConfirm={async () => await remove({ table: 'testimonials', id: row.id })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whether the client has said their words may go on the website, which is what publishing waits for. */
function Approval({ id }: { id: string }) {
  const item = useQuery(api.cms.get, { table: 'testimonials', id });
  const update = useMutation(api.cms.updateTestimonial);
  if (!item || !('quote' in item)) return null;

  const approved = item.approvedByClientAt !== undefined;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className={approved ? 'text-muted-foreground' : 'text-destructive'}>
        {approved ? 'The client has approved this.' : 'The client has not approved this yet.'}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          void update({
            testimonialId: item._id,
            approved: !approved,
            quote: item.quote,
            authorName: item.authorName,
            authorRole: item.authorRole,
            clientId: item.clientId,
            workId: item.workId,
          })
        }
      >
        {approved ? 'Take that back' : 'Record their approval'}
      </Button>
    </div>
  );
}

function PublishQuote({ id, publish }: { id: string; publish: ReturnType<typeof useMutation> }) {
  const item = useQuery(api.cms.get, { table: 'testimonials', id });
  const blocked = !item || item.blockers.length > 0;
  return (
    <Button type="button" size="sm" disabled={blocked} onClick={() => void publish({ table: 'testimonials', id })}>
      Publish
    </Button>
  );
}
