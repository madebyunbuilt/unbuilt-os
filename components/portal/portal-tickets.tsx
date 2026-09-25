'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AttachmentsField, useAttachments } from '@/components/app/attachments-field';
import { FormDialog } from '@/components/app/form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { formatMoment, type TicketPriority } from '@/lib/support-display';
import { type StatusTone } from '@/lib/team-display';

// Support as the client sees it (12-client-portal.md, Support). They say what is wrong, read what Unbuilt said back,
// and are told plainly whose turn it is. No SLA timers here: what the studio is scored on is the studio's business.

type PortalTicket = (typeof api.portalTickets.list._returnType)[number];

const STATUS: Record<PortalTicket['status'], { label: string; tone: StatusTone }> = {
  with_unbuilt: { label: 'With Unbuilt', tone: 'draft' },
  with_you: { label: 'Waiting on you', tone: 'attention' },
  resolved: { label: 'Resolved', tone: 'built' },
  closed: { label: 'Closed', tone: 'muted' },
};

/** What the client is choosing between. The studio's P-codes mean nothing to them, so they never appear. */
const HOW_BAD: { value: TicketPriority; label: string }[] = [
  { value: 'p1', label: 'Everything is down, or data is at risk' },
  { value: 'p2', label: 'Something important is broken, with no way around it' },
  { value: 'p3', label: 'Something is wrong, but there is a way around it' },
  { value: 'p4', label: 'A question, or a small change' },
];

export function RaiseTicket({ onRaised }: { onRaised?: (ticketId: Id<'tickets'>) => void }) {
  const create = useMutation(api.portalTickets.create);
  const generateUploadUrl = useMutation(api.portalTickets.generateUploadUrl);
  const attachments = useAttachments(() => generateUploadUrl({}));
  const projects = useQuery(api.portal.projects, {});
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('p3');
  const [projectId, setProjectId] = useState('');

  return (
    <FormDialog
      trigger={<Button>Ask for help</Button>}
      title="Ask for help"
      // No email promise: until the communications step, a reply only arrives in the portal (12-client-portal.md).
      description="Tell Unbuilt what is wrong. Their reply appears on this page, and in your notifications."
      submitLabel="Send it"
      canSubmit={subject.trim().length > 0 && description.trim().length > 0}
      onSubmit={async () => {
        const ticketId = await create({
          subject,
          description,
          priority,
          projectId: projectId ? (projectId as Id<'projects'>) : undefined,
          uploads: await attachments.upload(),
        });
        attachments.clear();
        onRaised?.(ticketId);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="portal-ticket-subject">What is it about</Label>
        <Input
          id="portal-ticket-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="portal-ticket-priority">How bad is it</Label>
        <NativeSelect
          id="portal-ticket-priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as TicketPriority)}
        >
          {HOW_BAD.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {(projects ?? []).length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="portal-ticket-project">Which project</Label>
          <NativeSelect
            id="portal-ticket-project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Not about a particular project</option>
            {(projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="portal-ticket-description">What is happening</Label>
        <Textarea
          id="portal-ticket-description"
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
        />
      </div>
      <AttachmentsField id="portal-ticket-files" label="Add a screenshot or a file" attachments={attachments} />
    </FormDialog>
  );
}

function Attachment({ file }: { file: { id: Id<'files'>; name: string } }) {
  const stored = useQuery(api.files.portalDownloadUrl, { fileId: file.id });
  if (!stored) return <li className="text-muted-foreground">{file.name}</li>;
  return (
    <li>
      <a href={stored.url} target="_blank" rel="noreferrer" className="underline">
        {file.name}
      </a>
    </li>
  );
}

export function PortalTickets() {
  const tickets = useQuery(api.portalTickets.list, {});
  if (tickets === undefined) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground">Anything you have asked Unbuilt to look at.</p>
        <RaiseTicket />
      </div>
      {tickets.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          Nothing here yet. If something is wrong, ask for help and Unbuilt will pick it up.
        </p>
      ) : (
        <ul className="space-y-3">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="rounded-lg border p-4">
              <Link href={`/tickets/${ticket.id}`} className="block">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{ticket.subject}</p>
                    <p className="text-sm text-muted-foreground">
                      {ticket.number} · raised {formatMoment(ticket.createdAt)}
                    </p>
                  </div>
                  <ToneBadge {...STATUS[ticket.status]} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PortalTicket({ ticketId }: { ticketId: Id<'tickets'> }) {
  const ticket = useQuery(api.portalTickets.get, { ticketId });
  const reply = useMutation(api.portalTickets.reply);
  const generateUploadUrl = useMutation(api.portalTickets.generateUploadUrl);
  const attachments = useAttachments(() => generateUploadUrl({}));
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (ticket === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (ticket === null) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">This ticket is not available.</p>;
  }

  // Replying to a ticket that was settled long ago opens a new one, which is worth saying before they type.
  const startsNew = (ticket.status === 'resolved' && !ticket.canReopen) || ticket.status === 'closed';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tickets" className="text-sm underline">
          ← Support
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold">{ticket.subject}</h1>
            <p className="mt-1 text-muted-foreground">
              {ticket.number} · raised {formatMoment(ticket.createdAt)}
              {ticket.projectName ? ` · ${ticket.projectName}` : ''}
            </p>
          </div>
          <ToneBadge {...STATUS[ticket.status]} />
        </div>
      </div>

      {ticket.status === 'with_you' && (
        <p className="rounded-md border p-4 text-sm">
          Unbuilt has asked you something. They are waiting on your answer before they carry on.
        </p>
      )}
      {ticket.status === 'resolved' && ticket.canReopen && (
        <p className="rounded-md border p-4 text-sm">
          Unbuilt believes this is sorted. If it is not, reply below and it opens again.
        </p>
      )}

      <ul className="space-y-3">
        {ticket.messages.map((message) => (
          <li key={message.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{message.fromUnbuilt ? 'Unbuilt' : 'You'}</p>
              <span className="text-xs text-muted-foreground tabular-nums">{formatMoment(message.createdAt)}</span>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{message.body}</p>
            {message.files.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {message.files.map((file) => (
                  <Attachment key={file.id} file={file} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setSending(true);
          setError(null);
          try {
            const result = await reply({ ticketId, body, uploads: await attachments.upload() });
            setBody('');
            attachments.clear();
            // A reply that started a new ticket has a new thread to go to.
            if (result.isNew) router.push(`/tickets/${result.ticketId}`);
          } catch (caught) {
            setError(errorMessage(caught));
          } finally {
            setSending(false);
          }
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="portal-ticket-reply">Reply</Label>
          <Textarea id="portal-ticket-reply" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
        </div>
        {startsNew && (
          <p className="text-sm text-muted-foreground">
            {ticket.status === 'closed'
              ? 'This one is closed, so your reply starts a new ticket. It will point back to this one.'
              : 'This was resolved more than a week ago, so your reply starts a new ticket. It will point back to this one.'}
          </p>
        )}
        <Button type="submit" disabled={sending || (body.trim().length === 0 && attachments.files.length === 0)}>
          {sending ? 'Sending…' : startsNew ? 'Start a new ticket' : 'Send'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
