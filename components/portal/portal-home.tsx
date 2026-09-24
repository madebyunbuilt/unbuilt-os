'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { api } from '@/convex/_generated/api';
import { ToneBadge } from '@/components/team/status-badge';
import { formatDay } from '@/lib/crm-display';

// The portal's home (12-client-portal.md, Navigation): what needs this client, then the work they have running. It
// shows what the server sent and nothing more — there is no budget, cost or rate in the answer to show.

const KIND_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  document: 'Document',
  deliverable: 'For review',
  changeRequest: 'Change request',
};

export function PortalHome() {
  const home = useQuery(api.portal.home, {});

  if (home === undefined) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">
          {home.contactName ? `Hello, ${home.contactName.split(' ')[0]}` : 'Hello'}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {home.clientName ? `${home.clientName} and Unbuilt Studio` : 'Your work with Unbuilt Studio'}
        </p>
      </div>

      <section aria-labelledby="needs-you" className="space-y-3">
        <h2 id="needs-you" className="font-display text-xl font-bold">
          Needs you
        </h2>
        {home.waiting.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">
            Nothing is waiting on you right now.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {home.waiting.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Link
                  href={item.href}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                  <ToneBadge label={KIND_LABELS[item.kind] ?? item.kind} tone="attention" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="your-projects" className="space-y-3">
        <h2 id="your-projects" className="font-display text-xl font-bold">
          Your projects
        </h2>
        {home.projects.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">Nothing running at the moment.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {home.projects.map((project) => (
              <li key={project.id} className="rounded-lg border p-4">
                <Link href={`/projects/${project.id}`} className="block">
                  <p className="font-medium">{project.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {project.milestones.done} of {project.milestones.total} milestones done
                  </p>
                  {project.nextMilestone && (
                    <p className="mt-2 text-sm">
                      Next: {project.nextMilestone.name}
                      {project.nextMilestone.dueDate ? ` · ${formatDay(project.nextMilestone.dueDate)}` : ''}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
