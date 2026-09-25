'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { AttachmentsField, useAttachments } from '@/components/app/attachments-field';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { useNow } from '@/lib/use-now';
import {
  formatMoment,
  PRIORITY_MEANING,
  priorityLabel,
  priorityTone,
  slaState,
  type TicketPriority,
  type TicketStatus,
  ticketStatus,
} from '@/lib/support-display';

// One ticket (09-support-and-sla.md). Two things have to be obvious the moment this opens: what the studio promised
// and how that promise is doing, and which of the messages the client can see.

type Ticket = NonNullable<typeof api.tickets.get._returnType>;
type Message = Ticket['messages'][number];

const STATUS_CHOICES: { value: Exclude<TicketStatus, 'new'>; label: string }[] = [
  { value: 'open', label: 'Open — with the studio' },
  { value: 'pending_client', label: 'Waiting on the client — stops the clock' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed — no more replies' },
];

/** What was promised, and how it is doing. Absent when the client has no SLA policy: there is nothing to report. */
function SlaPanel({ ticket, now }: { ticket: Ticket; now: number }) {
  if (!ticket.hasSla) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        This client has no SLA policy, so nothing was promised about when this is answered or fixed.
      </p>
    );
  }
  const paused = ticket.pausedAt !== undefined;
  const reply = slaState('Reply', { dueAt: ticket.firstResponseDueAt, met: ticket.firstRespondedAt, now }, true);
  const fix = slaState('Fix', { dueAt: ticket.resolutionDueAt, met: ticket.resolvedAt, now }, true);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Promised under {ticket.slaPolicyName}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ToneBadge {...reply} />
            <ToneBadge {...(paused ? { label: 'Fix — clock paused', tone: 'muted' as const } : fix)} />
          </div>
        </div>
        <dl className="text-right text-sm text-muted-foreground">
          {ticket.firstResponseDueAt !== undefined && (
            <div>
              <dt className="inline">First reply by </dt>
              <dd className="inline tabular-nums">{formatMoment(ticket.firstResponseDueAt)}</dd>
            </div>
          )}
          {ticket.resolutionDueAt !== undefined && (
            <div>
              <dt className="inline">Fixed by </dt>
              <dd className="inline tabular-nums">{formatMoment(ticket.resolutionDueAt)}</dd>
            </div>
          )}
        </dl>
      </div>
      {paused && (
        <p className="mt-3 text-sm text-muted-foreground">
          The clock is stopped while this waits on the client. The time they take is added back when it starts again, so
          it is not counted against the studio.
        </p>
      )}
    </div>
  );
}

function Attachment({ file }: { file: Message['files'][number] }) {
  const stored = useQuery(api.files.teamDownloadUrl, { fileId: file.id });
  if (!stored) return <li className="text-muted-foreground">{file.name}</li>;
  return (
    <li>
      <a href={stored.url} target="_blank" rel="noreferrer" className="underline">
        {file.name}
      </a>
    </li>
  );
}

function ThreadMessage({ message }: { message: Message }) {
  const internal = message.visibility === 'internal';
  return (
    <li className={internal ? 'rounded-lg border border-dashed bg-muted/40 p-4' : 'rounded-lg border p-4'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {message.authorKind === 'client' ? 'The client' : message.authorKind === 'team' ? 'Unbuilt' : 'Automatic'}
        </p>
        <div className="flex items-center gap-2">
          {internal && <ToneBadge label="Internal note" tone="muted" />}
          <span className="text-xs text-muted-foreground tabular-nums">{formatMoment(message.createdAt)}</span>
        </div>
      </div>
      <p className="mt-2 text-sm whitespace-pre-wrap">{message.body}</p>
      {message.files.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {message.files.map((file) => (
            <Attachment key={file.id} file={file} />
          ))}
        </ul>
      )}
      {internal && <p className="mt-2 text-xs text-muted-foreground">The client never sees this.</p>}
    </li>
  );
}

function Reply({ ticket }: { ticket: Ticket }) {
  const reply = useMutation(api.tickets.reply);
  const generateUploadUrl = useMutation(api.tickets.generateUploadUrl);
  const attachments = useAttachments(() => generateUploadUrl({}));
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setSending(true);
        setError(null);
        try {
          await reply({ ticketId: ticket.id, body, visibility, uploads: await attachments.upload() });
          setBody('');
          attachments.clear();
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setSending(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="ticket-reply">
          {visibility === 'public' ? 'Reply to the client' : 'A note for the studio'}
        </Label>
        <Textarea id="ticket-reply" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
      <AttachmentsField
        id="ticket-reply-files"
        label={visibility === 'public' ? 'Attach a file for the client' : 'Attach a file to the note'}
        attachments={attachments}
        disabled={sending}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor="ticket-visibility" className="text-xs text-muted-foreground">
            Who sees this
          </Label>
          <NativeSelect
            id="ticket-visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as 'public' | 'internal')}
          >
            <option value="public">The client</option>
            <option value="internal">Only the studio</option>
          </NativeSelect>
        </div>
        <Button type="submit" disabled={sending || (body.trim().length === 0 && attachments.files.length === 0)}>
          {sending ? 'Sending…' : visibility === 'public' ? 'Send to the client' : 'Save the note'}
        </Button>
      </div>
      {/* The first public reply is what stops the clock, so it is worth saying which one this is. */}
      {ticket.firstRespondedAt === undefined && visibility === 'internal' && (
        <p className="text-xs text-muted-foreground">
          A note does not count as the first reply: the client has still heard nothing.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

export function TicketDetail({ ticketId, permissions }: { ticketId: Id<'tickets'>; permissions: readonly string[] }) {
  const ticket = useQuery(api.tickets.get, { ticketId });
  const members = useQuery(api.team.list, {});
  const setStatus = useMutation(api.tickets.setStatus);
  const setPriority = useMutation(api.tickets.setPriority);
  const assign = useMutation(api.tickets.assign);
  const [error, setError] = useState<string | null>(null);
  const canManage = permissions.includes('tickets.manage');
  const now = useNow();

  if (ticket === undefined) return <p className="text-muted-foreground">Loading…</p>;

  const run = async (work: Promise<unknown>) => {
    setError(null);
    try {
      await work;
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };
  const closed = ticket.status === 'closed';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/support/tickets" className="text-sm underline">
          ← Tickets
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold">{ticket.subject}</h1>
            <p className="mt-1 text-muted-foreground">
              {ticket.number} · {ticket.clientName} · raised {formatMoment(ticket.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge label={priorityLabel(ticket.priority)} tone={priorityTone(ticket.priority)} />
            <ToneBadge {...ticketStatus(ticket.status)} />
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <SlaPanel ticket={ticket} now={now} />

      {canManage && !closed && (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ticket-set-status" className="text-xs text-muted-foreground">
              Where it stands
            </Label>
            <NativeSelect
              id="ticket-set-status"
              value={ticket.status === 'new' ? 'open' : ticket.status}
              onChange={(event) => run(setStatus({ ticketId, status: event.target.value as never }))}
            >
              {STATUS_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticket-set-priority" className="text-xs text-muted-foreground">
              Priority
            </Label>
            <NativeSelect
              id="ticket-set-priority"
              value={ticket.priority}
              onChange={(event) => run(setPriority({ ticketId, priority: event.target.value as TicketPriority }))}
            >
              {(Object.keys(PRIORITY_MEANING) as TicketPriority[]).map((value) => (
                <option key={value} value={value}>
                  {priorityLabel(value)} — {PRIORITY_MEANING[value]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticket-assignee" className="text-xs text-muted-foreground">
              Who is on it
            </Label>
            <NativeSelect
              id="ticket-assignee"
              value={ticket.assigneeMemberId ?? ''}
              onChange={(event) =>
                run(
                  assign({
                    ticketId,
                    assigneeMemberId: event.target.value ? (event.target.value as Id<'teamMembers'>) : undefined,
                  }),
                )
              }
            >
              <option value="">Nobody yet</option>
              {(members ?? [])
                .filter((member) => member.status === 'active')
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          {/* Changing the priority moves the promise, which is not obvious from a dropdown. */}
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Changing the priority works the promise out again from when the ticket was raised, so an escalation is due
            sooner rather than starting a fresh clock.
          </p>
        </div>
      )}

      <section aria-labelledby="thread" className="space-y-3">
        <h2 id="thread" className="font-display text-xl font-bold">
          The thread
        </h2>
        <ul className="space-y-3">
          {ticket.messages.map((message) => (
            <ThreadMessage key={message.id} message={message} />
          ))}
        </ul>
      </section>

      {canManage &&
        (closed ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            This ticket is closed. Raise a new one if the client comes back.
          </p>
        ) : (
          <Reply ticket={ticket} />
        ))}
    </div>
  );
}
