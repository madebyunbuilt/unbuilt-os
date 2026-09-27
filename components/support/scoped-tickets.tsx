'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { ToneBadge } from '@/components/team/status-badge';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import {
  formatMoment,
  priorityLabel,
  priorityTone,
  type TicketPriority,
  ticketSla,
  ticketStatus,
} from '@/lib/support-display';
import { useNow } from '@/lib/use-now';

// The tickets belonging to one client or one project (09-support-and-sla.md). The same rows the support list shows,
// on the page somebody is already looking at, so they do not have to go to Support and filter their way back here.

type Ticket = (typeof api.tickets.forClient._returnType)[number];

/** Whatever is closest to running out first, as on the support list. */
function urgency(ticket: Ticket): number {
  if (ticket.status === 'pending_client') return Number.MAX_SAFE_INTEGER - 1;
  const due = ticket.firstRespondedAt === undefined ? ticket.firstResponseDueAt : ticket.resolutionDueAt;
  return due ?? Number.MAX_SAFE_INTEGER;
}

function TicketRows({ tickets }: { tickets: Ticket[] }) {
  const now = useNow();
  if (tickets.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-muted-foreground">
        No tickets here. Anything raised in the portal, by email or by the studio appears on this page.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {[...tickets]
        .sort((a, b) => urgency(a) - urgency(b) || b.createdAt - a.createdAt)
        .map((ticket) => (
          <li key={ticket.id} className="rounded-lg border p-4">
            <Link href={`/support/tickets/${ticket.id}`} className="block">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{ticket.subject}</p>
                  <p className="text-sm text-muted-foreground">
                    {ticket.number} · raised {formatMoment(ticket.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ToneBadge
                    label={priorityLabel(ticket.priority as TicketPriority)}
                    tone={priorityTone(ticket.priority as TicketPriority)}
                  />
                  <ToneBadge {...ticketStatus(ticket.status)} />
                  <ToneBadge {...ticketSla(ticket, now)} />
                </div>
              </div>
            </Link>
          </li>
        ))}
    </ul>
  );
}

export function ClientTickets({ clientId }: { clientId: Id<'clients'> }) {
  const tickets = useQuery(api.tickets.forClient, { clientId });
  if (tickets === undefined) return <p className="text-muted-foreground">Loading tickets…</p>;
  return <TicketRows tickets={tickets} />;
}

export function ProjectTickets({ projectId }: { projectId: Id<'projects'> }) {
  const tickets = useQuery(api.tickets.list, { projectId, status: 'all' });
  if (tickets === undefined) return <p className="text-muted-foreground">Loading tickets…</p>;
  return <TicketRows tickets={tickets} />;
}
