'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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

// Quotes (13-cms-and-website.md). Short enough that the list is the whole screen, so the list shows the quote itself
// rather than a label standing in for it, and the client's approval sits with it because that is what publishing waits
// for.

type Testimonial = NonNullable<typeof api.cms.testimonials._returnType>[number];

function TestimonialForm({ trigger, existing }: { trigger: ReactNode; existing?: Testimonial }) {
  const create = useMutation(api.cms.createTestimonial);
  const update = useMutation(api.cms.updateTestimonial);
  const works = useQuery(api.cms.list, { table: 'works' });
  const clients = useQuery(api.clients.list, {});
  const [quote, setQuote] = useState(existing?.quote ?? '');
  const [authorName, setAuthorName] = useState(existing?.authorName ?? '');
  const [authorRole, setAuthorRole] = useState(existing?.authorRole ?? '');
  const [workId, setWorkId] = useState<string>(existing?.workId ?? '');
  const [clientId, setClientId] = useState<string>(existing?.clientId ?? '');

  return (
    <FormDialog
      trigger={trigger}
      title={existing ? 'Change this quote' : 'Add a quote'}
      description="It cannot be published until the client has approved it going on the website."
      submitLabel={existing ? 'Save' : 'Add it'}
      canSubmit={quote.trim().length > 0 && authorName.trim().length > 0}
      onSubmit={async () => {
        const fields = {
          quote,
          authorName,
          authorRole,
          workId: workId ? (workId as Id<'works'>) : undefined,
          clientId: clientId ? (clientId as Id<'clients'>) : undefined,
        };
        if (existing) await update({ testimonialId: existing.id, ...fields });
        else await create(fields);
        if (!existing) {
          setQuote('');
          setAuthorName('');
          setAuthorRole('');
          setWorkId('');
          setClientId('');
        }
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
          <Input
            id="quote-role"
            value={authorRole}
            onChange={(event) => setAuthorRole(event.target.value)}
            placeholder="Founder"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="quote-client">Which client</Label>
        <NativeSelect id="quote-client" value={clientId} onChange={(event) => setClientId(event.target.value)}>
          <option value="">Not linked to one</option>
          {(clients ?? []).map((client) => (
            <option key={client.id} value={client.id}>
              {client.displayName}
            </option>
          ))}
        </NativeSelect>
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
        <p className="text-sm text-muted-foreground">It shows on that case study as well as the home page.</p>
      </div>
    </FormDialog>
  );
}

export function Testimonials() {
  const rows = useQuery(api.cms.testimonials, {});
  const publish = useMutation(api.cmsPublish.publish);
  const unpublish = useMutation(api.cmsPublish.unpublish);
  const remove = useMutation(api.cmsPublish.remove);
  const update = useMutation(api.cms.updateTestimonial);

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
          {rows.map((row) => {
            const approved = row.approvedByClientAt !== undefined;
            const about = [row.clientName, row.workName].filter(Boolean).join(' · ');
            return (
              <li key={row.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  {/* The quote itself, which is the thing somebody came to this screen to read. */}
                  <blockquote className="min-w-0 flex-1 text-pretty">“{row.quote}”</blockquote>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.unpublishedChanges && <Badge variant="secondary">Edits waiting</Badge>}
                    <Badge variant={row.status === 'published' ? 'default' : 'outline'}>
                      {statusLabel(row.status)}
                    </Badge>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  {row.authorName}
                  {row.authorRole && `, ${row.authorRole}`}
                  {about && ` — ${about}`}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
                  <span className={approved ? 'text-muted-foreground' : 'text-destructive'}>
                    {approved ? 'The client has approved this.' : 'The client has not approved this yet.'}
                  </span>
                  {approved ? (
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm">
                          Take that back
                        </Button>
                      }
                      title="Take back the client’s approval?"
                      description={
                        row.status === 'published'
                          ? 'This quote is on the website. Taking the approval back takes it down at the next rebuild, because the client has not agreed to it being there.'
                          : 'It cannot be published again until the client approves it.'
                      }
                      confirmLabel={row.status === 'published' ? 'Take it back and take it down' : 'Take it back'}
                      onConfirm={async () =>
                        await update({
                          testimonialId: row.id,
                          approved: false,
                          quote: row.quote,
                          authorName: row.authorName,
                          authorRole: row.authorRole,
                          clientId: row.clientId,
                          workId: row.workId,
                        })
                      }
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void update({
                          testimonialId: row.id,
                          approved: true,
                          quote: row.quote,
                          authorName: row.authorName,
                          authorRole: row.authorRole,
                          clientId: row.clientId,
                          workId: row.workId,
                        })
                      }
                    >
                      Record their approval
                    </Button>
                  )}
                </div>

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
                    <Button
                      type="button"
                      size="sm"
                      disabled={row.blockers.length > 0}
                      title={row.blockers[0]?.message}
                      onClick={() => void publish({ table: 'testimonials', id: row.id })}
                    >
                      Publish
                    </Button>
                  )}
                  <TestimonialForm
                    existing={row}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    }
                  />
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
