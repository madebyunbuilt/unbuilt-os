'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProjectFormDialog } from '@/components/projects/project-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatDay } from '@/lib/crm-display';
import { projectStatus } from '@/lib/projects-display';

/** A client's projects, on the client page (05-crm.md, Clients). Projects outside the viewer's scope are not listed. */
export function ClientProjects({ clientId, permissions }: { clientId: Id<'clients'>; permissions: string[] }) {
  const router = useRouter();
  const rows = useQuery(api.projects.list, { clientId, status: 'all' });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-bold">Projects</h2>
        {permissions.includes('projects.create') && (
          <div className="sm:ml-auto">
            <ProjectFormDialog
              clientId={clientId}
              canPickManager={permissions.includes('team.view')}
              onSaved={(projectId) => router.push(`/projects/${projectId}`)}
              trigger={
                <Button variant="outline">
                  <Plus aria-hidden />
                  New project
                </Button>
              }
            />
          </div>
        )}
      </div>
      {rows === undefined ? (
        <p className="text-muted-foreground">Loading projects…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">No projects for this client yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 hover:bg-muted/50"
              >
                <span className="font-medium">{project.name}</span>
                <span className="text-sm text-muted-foreground">
                  {project.code} · {formatDay(project.startDate)}
                  {project.dueDate ? ` → ${formatDay(project.dueDate)}` : ''}
                </span>
                <span className="sm:ml-auto">
                  <ToneBadge {...projectStatus(project.status)} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
