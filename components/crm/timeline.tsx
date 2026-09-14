'use client';

import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { AtSign, CalendarClock, MessageSquareText, Phone, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import {
  ACTIVITY_TYPE_LABELS,
  fromMentionMarkup,
  type Mention,
  mentionSegments,
  toMentionMarkup,
} from '@/lib/crm-display';

// The activity timeline for a client, contact or deal (05-crm.md, Activity timeline).

export type TimelineSubject = { table: 'clients' | 'contacts' | 'deals'; id: string };
type ManualType = 'note' | 'call' | 'meeting';
type Entry = (typeof api.activities.list._returnType)['page'][number];

const PAGE_SIZE = 20;

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function TypeIcon({ type }: { type: string }) {
  const Icon =
    type === 'call' ? Phone : type === 'meeting' ? CalendarClock : type === 'note' ? MessageSquareText : Sparkles;
  return <Icon aria-hidden className="size-4" />;
}

export function MentionText({ body }: { body: string }) {
  return (
    <p className="text-sm whitespace-pre-wrap">
      {mentionSegments(body).map((segment, index) =>
        segment.kind === 'mention' ? (
          <span key={index} className="font-medium">
            @{segment.name}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/** Notes, calls and meetings, newest first, with a composer for people who can add to it. */
export function Timeline({
  subject,
  canAdd,
  canMention,
  limit,
}: {
  subject: TimelineSubject;
  canAdd: boolean;
  /** Whether the viewer can list the team (team.view) to pick people to mention. */
  canMention: boolean;
  /** Show only the latest entries, without paging. */
  limit?: number;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.activities.list,
    { subject },
    { initialNumItems: limit ?? PAGE_SIZE },
  );
  const entries = limit ? results.slice(0, limit) : results;

  return (
    <div className="space-y-6">
      {canAdd && <Composer subject={subject} canMention={canMention} />}
      {status === 'LoadingFirstPage' ? (
        <p className="text-muted-foreground">Loading the timeline…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">Nothing on the timeline yet.</p>
      ) : (
        <ol className="space-y-4" aria-label="Timeline">
          {entries.map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} canMention={canMention} />
          ))}
        </ol>
      )}
      {!limit && status === 'CanLoadMore' && (
        <Button variant="outline" onClick={() => loadMore(PAGE_SIZE)}>
          Show older entries
        </Button>
      )}
    </div>
  );
}

function TimelineEntry({ entry, canMention }: { entry: Entry; canMention: boolean }) {
  const [editing, setEditing] = useState(false);
  const remove = useMutation(api.activities.remove);
  const manual = entry.type === 'note' || entry.type === 'call' || entry.type === 'meeting';

  return (
    <li className="flex gap-3">
      <span
        className={
          manual
            ? 'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border'
            : 'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'
        }
      >
        <TypeIcon type={entry.type} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="font-medium">{entry.title}</p>
          <p className="text-sm text-muted-foreground">
            {entry.actorName} ·{' '}
            <time dateTime={new Date(entry.occurredAt).toISOString()}>{dateTime.format(entry.occurredAt)}</time>
            {entry.editedAt && ' · edited'}
          </p>
        </div>
        {editing ? (
          <EntryEditor entry={entry} canMention={canMention} onDone={() => setEditing(false)} />
        ) : (
          entry.body && <MentionText body={entry.body} />
        )}
        {!editing && (entry.canEdit || entry.canDelete) && (
          <div className="flex gap-1">
            {entry.canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {entry.canDelete && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm">
                    Delete
                  </Button>
                }
                title={`Delete this ${ACTIVITY_TYPE_LABELS[entry.type]?.toLowerCase() ?? 'entry'}?`}
                description="It is removed from the timeline. The audit log keeps a record of what it said."
                confirmLabel="Delete"
                onConfirm={() => remove({ activityId: entry.id as Id<'activities'> })}
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Text with an @mention picker. Chosen people are tracked by id and turned into markup when saved. */
function MentionField({
  id,
  label,
  value,
  onChange,
  mentions,
  onMentionsChange,
  canMention,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  mentions: Mention[];
  onMentionsChange: (mentions: Mention[]) => void;
  canMention: boolean;
}) {
  const [open, setOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const team = useQuery(api.team.list, canMention && open ? {} : 'skip');

  const insert = (member: Mention) => {
    const element = textarea.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const spacer = before && !/\s$/.test(before) ? ' ' : '';
    const token = `${spacer}@${member.name} `;
    onChange(`${before}${token}${value.slice(end)}`);
    if (!mentions.some((mention) => mention.id === member.id)) onMentionsChange([...mentions, member]);
    setOpen(false);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {canMention && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <AtSign aria-hidden />
                Mention someone
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end">
              <Command>
                <CommandInput placeholder="Search the team" />
                <CommandList>
                  <CommandEmpty>{team === undefined ? 'Loading…' : 'Nobody matches.'}</CommandEmpty>
                  {team
                    ?.filter((member) => member.status === 'active')
                    .map((member) => (
                      <CommandItem
                        key={member.id}
                        value={member.name}
                        onSelect={() => insert({ id: member.id, name: member.name })}
                      >
                        {member.name}
                      </CommandItem>
                    ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <Textarea id={id} ref={textarea} rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
      {canMention && <p className="text-sm text-muted-foreground">People you mention are notified.</p>}
    </div>
  );
}

function Composer({ subject, canMention }: { subject: TimelineSubject; canMention: boolean }) {
  const add = useMutation(api.activities.add);
  const [type, setType] = useState<ManualType>('note');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const idPrefix = `timeline-${subject.table}-${subject.id}`;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await add({
        subject,
        type,
        title: title || undefined,
        body: toMentionMarkup(text, mentions),
        occurredAt: type !== 'note' && when ? new Date(when).getTime() : undefined,
      });
      setText('');
      setTitle('');
      setWhen('');
      setMentions([]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      aria-label="Add to the timeline"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-type`}>Type</Label>
          <NativeSelect
            id={`${idPrefix}-type`}
            value={type}
            onChange={(event) => setType(event.target.value as ManualType)}
          >
            <option value="note">Note</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
          </NativeSelect>
        </div>
        {type !== 'note' && (
          <>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-title`}>Title (optional)</Label>
              <Input id={`${idPrefix}-title`} value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-when`}>When</Label>
              <Input
                id={`${idPrefix}-when`}
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
              />
            </div>
          </>
        )}
      </div>
      <MentionField
        id={`${idPrefix}-body`}
        label={type === 'note' ? 'Note' : 'What happened'}
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
      <Button type="submit" disabled={saving || !text.trim()}>
        {saving ? 'Adding…' : `Add ${type}`}
      </Button>
    </form>
  );
}

function EntryEditor({ entry, canMention, onDone }: { entry: Entry; canMention: boolean; onDone: () => void }) {
  const update = useMutation(api.activities.update);
  const initial = fromMentionMarkup(entry.body ?? '');
  const [text, setText] = useState(initial.text);
  const [mentions, setMentions] = useState<Mention[]>(initial.mentions);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          await update({ activityId: entry.id as Id<'activities'>, body: toMentionMarkup(text, mentions) });
          onDone();
        } catch (caught) {
          setError(errorMessage(caught));
        }
      }}
    >
      <MentionField
        id={`edit-${entry.id}`}
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
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
