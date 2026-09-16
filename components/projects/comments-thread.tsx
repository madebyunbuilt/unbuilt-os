'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { MentionField, MentionText } from '@/components/crm/timeline';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { fromMentionMarkup, type Mention, toMentionMarkup } from '@/lib/crm-display';

// Comments on a deliverable or task (06-projects.md, Comments). Internal comments stay with the team; client-visible
// ones are shown in the portal, so the difference is spelled out on every comment.

export type CommentTarget = { table: 'deliverables' | 'tasks'; id: string };

type Comment = (typeof api.comments.list._returnType)['comments'][number];

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function CommentsThread({ target, canMention }: { target: CommentTarget; canMention: boolean }) {
  const data = useQuery(api.comments.list, { target });

  return (
    <div className="space-y-6">
      <h2 className="font-display text-xl font-bold">Comments</h2>
      <Composer target={target} canPostToClient={data?.canPostToClient ?? false} canMention={canMention} />
      {data === undefined ? (
        <p className="text-muted-foreground">Loading comments…</p>
      ) : data.comments.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">No comments yet.</p>
      ) : (
        <ol className="space-y-4" aria-label="Comments">
          {[...data.comments]
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((comment) => (
              <CommentRow key={comment.id} comment={comment} canMention={canMention} />
            ))}
        </ol>
      )}
    </div>
  );
}

function CommentRow({ comment, canMention }: { comment: Comment; canMention: boolean }) {
  const update = useMutation(api.comments.update);
  const remove = useMutation(api.comments.remove);
  const [editing, setEditing] = useState(false);
  const initial = fromMentionMarkup(comment.body);
  const [text, setText] = useState(initial.text);
  const [mentions, setMentions] = useState<Mention[]>(initial.mentions);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="font-medium">{comment.authorName}</p>
        <p className="text-sm text-muted-foreground">
          <time dateTime={new Date(comment.createdAt).toISOString()}>{dateTime.format(comment.createdAt)}</time>
          {comment.editedAt && ' · edited'}
          {' · '}
          {comment.visibility === 'client' ? 'Visible to the client' : 'Internal'}
        </p>
      </div>
      {editing ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            try {
              await update({ commentId: comment.id as Id<'comments'>, body: toMentionMarkup(text, mentions) });
              setEditing(false);
            } catch (caught) {
              setError(errorMessage(caught));
            }
          }}
        >
          <MentionField
            id={`comment-edit-${comment.id}`}
            label="Edit"
            value={text}
            onChange={setText}
            mentions={mentions}
            onMentionsChange={setMentions}
            canMention={canMention}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!text.trim()}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-1 space-y-1">
          <MentionText body={comment.body} />
          {comment.canEdit && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm">
                    Delete
                  </Button>
                }
                title="Delete this comment?"
                description={
                  comment.visibility === 'client'
                    ? 'The client will no longer see it in the portal.'
                    : 'It is removed from the thread.'
                }
                confirmLabel="Delete"
                onConfirm={() => remove({ commentId: comment.id as Id<'comments'> })}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Composer({
  target,
  canPostToClient,
  canMention,
}: {
  target: CommentTarget;
  canPostToClient: boolean;
  canMention: boolean;
}) {
  const add = useMutation(api.comments.add);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [visibility, setVisibility] = useState<'internal' | 'client'>('internal');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      aria-label="Add a comment"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await add({ target, body: toMentionMarkup(text, mentions), visibility });
          setText('');
          setMentions([]);
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setSaving(false);
        }
      }}
    >
      <MentionField
        id={`comment-${target.table}-${target.id}`}
        label="Comment"
        value={text}
        onChange={setText}
        mentions={mentions}
        onMentionsChange={setMentions}
        canMention={canMention}
      />
      <div className="flex flex-wrap items-end gap-3">
        {canPostToClient && (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`comment-visibility-${target.id}`}>
              Who can see it
            </label>
            <NativeSelect
              id={`comment-visibility-${target.id}`}
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as 'internal' | 'client')}
            >
              <option value="internal">The team only</option>
              <option value="client">The team and the client</option>
            </NativeSelect>
          </div>
        )}
        <Button type="submit" disabled={saving || !text.trim()}>
          {saving ? 'Adding…' : 'Add comment'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
