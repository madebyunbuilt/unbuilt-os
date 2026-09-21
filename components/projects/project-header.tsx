'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, ChevronDown, Pencil } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ProjectFormDialog } from '@/components/projects/project-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { PROJECT_STATUS_LABELS, PROJECT_TRANSITIONS, type ProjectStatus } from '@/convex/lib/projectStatus';
import { errorMessage } from '@/lib/convex-error';
import { PROJECT_TYPE_LABELS, projectStatus } from '@/lib/projects-display';
import { cn } from '@/lib/utils';

type Tab = { label: string; segment: string; built: boolean; anyOf?: string[] };

// Project page tabs (06-projects.md, Projects). Tabs for modules not built yet stay visible but inert, like the menu.
export const PROJECT_TABS: Tab[] = [
  { label: 'Overview', segment: '', built: true },
  { label: 'Milestones and deliverables', segment: 'milestones', built: true },
  { label: 'Tasks', segment: 'tasks', built: true },
  { label: 'Time', segment: 'time', built: true },
  { label: 'Change requests', segment: 'change-requests', built: false },
  {
    label: 'Documents',
    segment: 'documents',
    built: true,
    anyOf: ['documents.view', 'documents.view.assigned'],
  },
  { label: 'Invoices', segment: 'invoices', built: false },
  { label: 'Files', segment: 'files', built: false },
  { label: 'Vault', segment: 'vault', built: false, anyOf: ['vault.view.all', 'vault.view.assigned'] },
  { label: 'Tickets', segment: 'tickets', built: false },
  { label: 'Updates', segment: 'updates', built: false },
  { label: 'Handover', segment: 'handover', built: false },
  { label: 'Members', segment: 'members', built: true },
  { label: 'Settings', segment: 'settings', built: true },
];

export function ProjectHeader({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const project = useQuery(api.projects.get, { projectId });
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const tabs = PROJECT_TABS.filter((tab) => !tab.anyOf || tab.anyOf.some((key) => permissions.includes(key)));

  return (
    <div className="space-y-6">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Projects
      </Link>

      {project === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold">{project.name}</h1>
              <ToneBadge {...projectStatus(project.status)} />
            </div>
            <p className="mt-1 text-muted-foreground">
              {project.code} · {/* Only roles that can open the client page get a link; everyone else sees the name. */}
              {permissions.includes('clients.view') ? (
                <Link href={`/crm/clients/${project.clientId}`} className="underline underline-offset-4">
                  {project.clientName}
                </Link>
              ) : (
                project.clientName
              )}{' '}
              · {PROJECT_TYPE_LABELS[project.type]}
            </p>
          </div>
          {permissions.includes('projects.update') && (
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <StatusMover project={project} canArchive={permissions.includes('projects.archive')} />
              <ProjectFormDialog
                project={project}
                canPickManager={permissions.includes('team.view')}
                trigger={
                  <Button variant="outline">
                    <Pencil aria-hidden />
                    Edit
                  </Button>
                }
              />
            </div>
          )}
        </header>
      )}

      <nav aria-label="Project sections" className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-1">
          {tabs.map((tab) => {
            const href = tab.segment ? `${base}/${tab.segment}` : base;
            const itemClass = 'block border-b-2 px-3 py-2 text-sm whitespace-nowrap';
            if (!tab.built) {
              return (
                <li key={tab.label}>
                  <span
                    aria-disabled="true"
                    title="Not built yet"
                    className={cn(itemClass, 'cursor-not-allowed border-transparent text-draft')}
                  >
                    {tab.label}
                  </span>
                </li>
              );
            }
            const active = tab.segment ? pathname.startsWith(href) : pathname === base;
            return (
              <li key={tab.label}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    itemClass,
                    'font-medium hover:text-foreground',
                    active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground',
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** Moves the project to a status it is allowed to reach, with an optional reason for the timeline. */
function StatusMover({
  project,
  canArchive,
}: {
  project: NonNullable<typeof api.projects.get._returnType>;
  canArchive: boolean;
}) {
  const setStatus = useMutation(api.projects.setStatus);
  const [target, setTarget] = useState<ProjectStatus | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const choices = PROJECT_TRANSITIONS[project.status].filter(
    (next) => canArchive || (next !== 'archived' && project.status !== 'archived'),
  );

  if (choices.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            Change status
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {choices.map((next) => (
            <DropdownMenuItem
              key={next}
              onSelect={() => {
                setTarget(next);
                setReason('');
                setError(null);
              }}
            >
              {PROJECT_STATUS_LABELS[next]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">
              Move to {target ? PROJECT_STATUS_LABELS[target].toLowerCase() : ''}
            </DialogTitle>
            <DialogDescription>
              {target === 'completed'
                ? 'Every milestone must be approved, invoiced or skipped first. The change goes on the timeline.'
                : 'The change goes on the project timeline.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="project-status-reason">Reason (optional)</Label>
            <Textarea
              id="project-status-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!target) return;
                setSaving(true);
                setError(null);
                try {
                  await setStatus({ projectId: project.id, status: target, reason: reason || undefined });
                  setTarget(null);
                } catch (caught) {
                  setError(errorMessage(caught));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving…' : 'Change status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
