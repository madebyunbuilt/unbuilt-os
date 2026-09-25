'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FormDialog } from '@/components/app/form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { useNow } from '@/lib/use-now';
import { type Id } from '@/convex/_generated/dataModel';
import {
  PRIORITY_MEANING,
  priorityLabel,
  priorityTone,
  type TicketPriority,
  ticketSla,
  ticketStatus,
} from '@/lib/support-display';

// Support tickets as the studio sees them (09-support-and-sla.md). The list is ordered by what is promised, not by
// what is newest: the point of an SLA is that the thing running out of time is the thing you look at first.

type Ticket = (typeof api.tickets.list._returnType)[number];

function RaiseTicket() {
  const create = useMutation(api.tickets.create);
  const clients = useQuery(api.clients.list, {});
  const [clientId, setClientId] = useState('');
  const projects = useQuery(api.projects.list, clientId ? { clientId: clientId as Id<'clients'> } : 'skip');
  const contacts = useQuery(api.contacts.listForClient, clientId ? { clientId: clientId as Id<'clients'> } : 'skip');
  const [projectId, setProjectId] = useState('');
  const [requesterContactId, setRequesterContactId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('p3');

  return (
    <FormDialog
      trigger={
        <Button>
          <Plus aria-hidden />
          Raise a ticket
        </Button>
      }
      title="Raise a ticket"
      description="For something a client has reported by phone, in a meeting or anywhere else that is not the portal."
      submitLabel="Raise it"
      canSubmit={Boolean(clientId) && subject.trim().length > 0 && description.trim().length > 0}
      onSubmit={() =>
        create({
          clientId: clientId as Id<'clients'>,
          projectId: projectId ? (projectId as Id<'projects'>) : undefined,
          requesterContactId: requesterContactId ? (requesterContactId as Id<'contacts'>) : undefined,
          subject,
          description,
          priority,
        })
      }
    >
      <div className="space-y-2">
        <Label htmlFor="ticket-client">Client</Label>
        <NativeSelect
          id="ticket-client"
          value={clientId}
          onChange={(event) => {
            setClientId(event.target.value);
            // The project and the contact belong to the old client, so they cannot stand.
            setProjectId('');
            setRequesterContactId('');
          }}
        >
          <option value="">Choose a client</option>
          {(clients ?? []).map((client) => (
            <option key={client.id} value={client.id}>
              {client.displayName}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-project">Project</Label>
        <NativeSelect
          id="ticket-project"
          value={projectId}
          disabled={!clientId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">No particular project</option>
          {(projects ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </NativeSelect>
        {/* Which policy applies follows the project, so this is not only filing. */}
        <p className="text-xs text-muted-foreground">A project with its own SLA policy sets what is promised here.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-requester">Who reported it</Label>
        <NativeSelect
          id="ticket-requester"
          value={requesterContactId}
          disabled={!clientId}
          onChange={(event) => setRequesterContactId(event.target.value)}
        >
          <option value="">Nobody in particular</option>
          {(contacts ?? []).map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-priority">Priority</Label>
        <NativeSelect
          id="ticket-priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as TicketPriority)}
        >
          {(Object.keys(PRIORITY_MEANING) as TicketPriority[]).map((value) => (
            <option key={value} value={value}>
              {priorityLabel(value)} — {PRIORITY_MEANING[value]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-subject">Subject</Label>
        <Input id="ticket-subject" value={subject} onChange={(event) => setSubject(event.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-description">What they reported</Label>
        <Textarea
          id="ticket-description"
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
        />
      </div>
    </FormDialog>
  );
}

/** Whatever is closest to running out first. Tickets with nothing promised sit below the ones that have a clock. */
function urgency(ticket: Ticket): number {
  // A ticket waiting on the client has no clock running, so it does not belong among the ones counting down.
  if (ticket.status === 'pending_client') return Number.MAX_SAFE_INTEGER - 1;
  const due = ticket.firstRespondedAt === undefined ? ticket.firstResponseDueAt : ticket.resolutionDueAt;
  return due ?? Number.MAX_SAFE_INTEGER;
}

const byUrgency = (a: Ticket, b: Ticket) => urgency(a) - urgency(b) || b.createdAt - a.createdAt;

export function TicketList({ permissions }: { permissions: readonly string[] }) {
  const [status, setStatus] = useState<'open' | 'mine' | 'all'>('open');
  const tickets = useQuery(api.tickets.list, { status });
  const now = useNow();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ticket-filter" className="text-xs text-muted-foreground">
            Show
          </Label>
          <NativeSelect
            id="ticket-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="open">Still open</option>
            <option value="mine">Mine</option>
            <option value="all">Everything</option>
          </NativeSelect>
        </div>
        {permissions.includes('tickets.manage') && (
          <div className="sm:ml-auto">
            <RaiseTicket />
          </div>
        )}
      </div>

      {tickets === undefined ? (
        <p className="text-muted-foreground">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          {status === 'mine' ? 'Nothing is assigned to you.' : 'No tickets here.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {[...tickets].sort(byUrgency).map((ticket) => {
            const sla = ticketSla(ticket, now);
            return (
              <li key={ticket.id} className="rounded-lg border p-4">
                <Link href={`/support/tickets/${ticket.id}`} className="block">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{ticket.subject}</p>
                      <p className="text-sm text-muted-foreground">
                        {ticket.number} · <ToneBadge {...ticketStatus(ticket.status)} />
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ToneBadge label={priorityLabel(ticket.priority)} tone={priorityTone(ticket.priority)} />
                      <ToneBadge {...sla} />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
