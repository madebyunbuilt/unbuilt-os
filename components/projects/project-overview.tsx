'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { type ReactNode } from 'react';
import { Timeline } from '@/components/crm/timeline';
import { ToneBadge } from '@/components/team/status-badge';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatMoney } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import { BILLING_MODEL_LABELS, formatHours, milestoneStatus } from '@/lib/projects-display';

// The project overview (06-projects.md, Projects). Budget used (time at cost, expenses and bills) arrives with billing.

const LINK_LABELS = { repo: 'Repository', staging: 'Staging', production: 'Production', design: 'Design' } as const;

function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ProjectOverview({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const project = useQuery(api.projects.get, { projectId });
  const milestones = useQuery(api.milestones.listForProject, { projectId });
  const time = useQuery(api.time.projectSummary, { projectId });

  if (project === undefined) return <p className="text-muted-foreground">Loading the project…</p>;

  const next = milestones?.milestones.find(
    (milestone) => !['approved', 'invoiced', 'skipped'].includes(milestone.status),
  );
  const links = Object.entries(LINK_LABELS).filter(([key]) => project.links[key as keyof typeof LINK_LABELS]);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Milestones"
          value={`${project.milestoneProgress.done} of ${project.milestoneProgress.total}`}
          hint={
            next ? (
              <>
                Next: {next.name} <ToneBadge {...milestoneStatus(next.status)} />
              </>
            ) : project.milestoneProgress.total === 0 ? (
              'None planned yet'
            ) : (
              'All done'
            )
          }
        />
        <Figure
          label="Open tasks"
          value={project.tasks.open}
          hint={project.tasks.overdue > 0 ? `${project.tasks.overdue} overdue` : 'Nothing overdue'}
        />
        <Figure
          label={time?.scope === 'own' ? 'My hours' : 'Hours logged'}
          value={time ? formatHours(time.loggedMinutes) : '—'}
          hint={
            time && time.estimateMinutes > 0
              ? `Estimated ${formatHours(time.estimateMinutes)}`
              : 'No estimates on tasks yet'
          }
        />
        <Figure
          label="Budget"
          value={project.budgetMinor === undefined ? 'Not set' : formatMoney(project.budgetMinor, project.currency)}
          hint={`${BILLING_MODEL_LABELS[project.billingModel]} · used arrives with billing`}
        />
      </div>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <h2 className="font-display text-xl font-bold">Timeline</h2>
          <Timeline
            subject={{ table: 'projects', id: projectId }}
            canAdd={permissions.includes('clients.view')}
            canMention={permissions.includes('team.view')}
          />
        </div>

        <div className="space-y-4">
          <h2 className="font-display text-xl font-bold">Details</h2>
          <dl className="space-y-3 rounded-lg border p-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Dates</dt>
              <dd>
                {formatDay(project.startDate)}
                {project.dueDate ? ` → ${formatDay(project.dueDate)}` : ' · no due date'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Manager</dt>
              <dd>{project.managerName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Members</dt>
              <dd>
                <Link href={`/projects/${projectId}/members`} className="underline underline-offset-4">
                  {project.members.length} on the project
                </Link>
              </dd>
            </div>
            {project.dealId && permissions.includes('deals.view') && (
              <div>
                <dt className="text-muted-foreground">Won deal</dt>
                <dd>
                  <Link href={`/crm/deals/${project.dealId}`} className="underline underline-offset-4">
                    {project.dealTitle ?? 'View the deal'}
                  </Link>
                </dd>
              </div>
            )}
            {links.length > 0 && (
              <div>
                <dt className="text-muted-foreground">Links</dt>
                <dd className="flex flex-col">
                  {links.map(([key, label]) => (
                    <a
                      key={key}
                      href={project.links[key as keyof typeof LINK_LABELS]}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-4"
                    >
                      {label}
                    </a>
                  ))}
                </dd>
              </div>
            )}
            {project.description && (
              <div>
                <dt className="text-muted-foreground">Description</dt>
                <dd className="whitespace-pre-wrap">{project.description}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>
    </div>
  );
}
