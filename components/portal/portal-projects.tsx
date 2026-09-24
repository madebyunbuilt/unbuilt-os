'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { ToneBadge } from '@/components/team/status-badge';
import { formatDay } from '@/lib/crm-display';
import { milestoneStatus, projectStatus } from '@/lib/portal-display';

// The client's own projects (12-client-portal.md). Progress and dates, and nothing about what the work costs the
// studio: the server does not send it, and there is nowhere here for it to appear.

export function PortalProjects() {
  const projects = useQuery(api.portal.projects, {});
  if (projects === undefined) return <p className="text-muted-foreground">Loading projects…</p>;
  if (projects.length === 0) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">Nothing running at the moment.</p>;
  }
  return (
    <ul className="space-y-3">
      {projects.map((project) => (
        <li key={project.id} className="rounded-lg border p-4">
          <Link href={`/portal/projects/${project.id}`} className="block">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{project.name}</p>
                <p className="text-sm text-muted-foreground">
                  Started {formatDay(project.startDate)}
                  {project.dueDate ? ` · due ${formatDay(project.dueDate)}` : ''}
                </p>
              </div>
              <ToneBadge {...projectStatus(project.status)} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {project.milestones.done} of {project.milestones.total} milestones done
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PortalProject({ projectId }: { projectId: Id<'projects'> }) {
  const project = useQuery(api.portal.project, { projectId });
  if (project === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (project === null) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">This project is not available.</p>;
  }
  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal/projects" className="text-sm underline">
          ← Projects
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">{project.name}</h1>
        <p className="mt-1 text-muted-foreground">
          Started {formatDay(project.startDate)}
          {project.dueDate ? ` · due ${formatDay(project.dueDate)}` : ''}
        </p>
      </div>

      <section aria-labelledby="milestones" className="space-y-3">
        <h2 id="milestones" className="font-display text-xl font-bold">
          Milestones
        </h2>
        {project.milestones.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">No milestones yet.</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {project.milestones.map((milestone) => (
              <li key={milestone.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{milestone.name}</p>
                  {milestone.dueDate && <p className="text-sm text-muted-foreground">{formatDay(milestone.dueDate)}</p>}
                </div>
                <ToneBadge {...milestoneStatus(milestone.status)} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
