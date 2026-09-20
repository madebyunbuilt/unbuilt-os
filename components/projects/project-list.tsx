'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProjectFormDialog } from '@/components/projects/project-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/convex/_generated/api';
import { formatDay } from '@/lib/crm-display';
import { PROJECT_STATUSES, PROJECT_TYPE_LABELS, projectStatus } from '@/lib/projects-display';

export function ProjectList({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<'open' | 'all' | (typeof PROJECT_STATUSES)[number]>('open');
  const [mine, setMine] = useState(false);
  const me = useQuery(api.team.me, {});
  const projects = useQuery(api.projects.list, {
    status,
    ...(mine && me ? { managerMemberId: me.id } : {}),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="project-status" className="text-xs text-muted-foreground">
            Show
          </Label>
          <NativeSelect
            id="project-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="open">Open projects</option>
            <option value="all">All projects</option>
            {PROJECT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {projectStatus(value).label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2 sm:h-9">
          <Switch id="project-mine" checked={mine} onCheckedChange={setMine} />
          <Label htmlFor="project-mine" className="font-normal">
            I manage
          </Label>
        </div>
        {permissions.includes('projects.create') && (
          <div className="sm:ml-auto">
            <ProjectFormDialog
              canPickManager={permissions.includes('team.view')}
              onSaved={(projectId) => router.push(`/projects/${projectId}`)}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  New project
                </Button>
              }
            />
          </div>
        )}
      </div>

      {projects === undefined ? (
        <p className="text-muted-foreground">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          {status === 'open' ? 'No open projects.' : 'Nothing here.'}
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start gap-2">
                <Link href={`/projects/${project.id}`} className="min-w-0">
                  <span className="block font-medium">{project.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {project.code} · {project.clientName}
                  </span>
                </Link>
                <span className="sm:ml-auto">
                  <ToneBadge {...projectStatus(project.status)} />
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Milestones</dt>
                <dd>
                  {project.milestoneProgress.done} of {project.milestoneProgress.total}
                  {project.nextMilestone ? ` · next: ${project.nextMilestone}` : ''}
                </dd>
                <dt className="text-muted-foreground">Manager</dt>
                <dd>{project.managerName}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd>{PROJECT_TYPE_LABELS[project.type]}</dd>
                <dt className="text-muted-foreground">Dates</dt>
                <dd>
                  {formatDay(project.startDate)}
                  {project.dueDate ? ` → ${formatDay(project.dueDate)}` : ''}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
