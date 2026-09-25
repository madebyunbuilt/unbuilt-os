'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { ToneBadge } from '@/components/team/status-badge';
import { formatDay } from '@/lib/crm-display';
import { changeRequestStatus, deliverableStatus, milestoneStatus, projectStatus } from '@/lib/portal-display';

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
          <Link href={`/projects/${project.id}`} className="block">
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

const hours = (minutes: number) => {
  const value = minutes / 60;
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
};

type Project = NonNullable<typeof api.portalProjects.project._returnType>;

/** A file the studio submitted, which the client opens to look at it. */
function Attachment({ file }: { file: Project['deliverables'][number]['files'][number] }) {
  const url = useQuery(api.files.portalDownloadUrl, { fileId: file.id });
  if (!url) return <li className="text-muted-foreground">{file.name}</li>;
  return (
    <li>
      <a href={url.url} target="_blank" rel="noreferrer" className="underline">
        {file.name}
      </a>
    </li>
  );
}

/** Approving what was delivered, or saying what is not right about it yet. */
function DeliverableActions({ deliverable }: { deliverable: Project['deliverables'][number] }) {
  const decide = useMutation(api.portalProjects.decideDeliverable);
  const [note, setNote] = useState('');
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <ConfirmDialog
        trigger={<Button>Approve</Button>}
        title={`Approve ${deliverable.title}`}
        description="This tells Unbuilt it is right, and the work moves on."
        confirmLabel="Approve"
        onConfirm={() => decide({ deliverableId: deliverable.id, version: deliverable.version, decision: 'approved' })}
      />
      <FormDialog
        trigger={<Button variant="outline">Ask for changes</Button>}
        title={`Ask for changes to ${deliverable.title}`}
        description="Unbuilt is told straight away, and sends a new version."
        submitLabel="Send this back"
        canSubmit={note.trim().length > 0}
        onSubmit={() =>
          decide({
            deliverableId: deliverable.id,
            version: deliverable.version,
            decision: 'changes_requested',
            note,
          })
        }
      >
        <div className="space-y-2">
          <Label htmlFor={`changes-${deliverable.id}`}>What needs changing</Label>
          <Textarea
            id={`changes-${deliverable.id}`}
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </FormDialog>
    </div>
  );
}

/** Deciding on a priced change, which moves what the project costs and when it is due. */
function ChangeRequestActions({ changeRequest }: { changeRequest: Project['changeRequests'][number] }) {
  const decide = useMutation(api.portalProjects.decideChangeRequest);
  const [reason, setReason] = useState('');
  const currency = changeRequest.impact.currency as Currency;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {!changeRequest.needsSignature && (
        <ConfirmDialog
          trigger={<Button>Approve this change</Button>}
          title="Approve this change"
          description={`This agrees ${formatMoney(changeRequest.impact.amountMinor, currency)}${
            changeRequest.impact.days > 0 ? ` and ${changeRequest.impact.days} more days` : ''
          }, and Unbuilt will invoice it.`}
          confirmLabel="Approve"
          onConfirm={() => decide({ changeRequestId: changeRequest.id, decision: 'approved' })}
        />
      )}
      <FormDialog
        trigger={<Button variant="outline">Decline</Button>}
        title="Decline this change"
        description="Nothing changes about the price or the dates. Unbuilt will see your reason."
        submitLabel="Decline"
        canSubmit={reason.trim().length > 0}
        onSubmit={() => decide({ changeRequestId: changeRequest.id, decision: 'declined', reason })}
      >
        <div className="space-y-2">
          <Label htmlFor={`cr-reason-${changeRequest.id}`}>Why</Label>
          <Textarea
            id={`cr-reason-${changeRequest.id}`}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </FormDialog>
    </div>
  );
}

export function PortalProject({ projectId }: { projectId: Id<'projects'> }) {
  const project = useQuery(api.portalProjects.project, { projectId });
  if (project === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (project === null) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">This project is not available.</p>;
  }
  return (
    <div className="space-y-6">
      <div>
        <Link href="/projects" className="text-sm underline">
          ← Projects
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">{project.name}</h1>
        <p className="mt-1 text-muted-foreground">
          Started {formatDay(project.startDate)}
          {project.dueDate ? ` · due ${formatDay(project.dueDate)}` : ''}
        </p>
      </div>

      {project.deliverables.length > 0 && (
        <section aria-labelledby="deliverables" className="space-y-3">
          <h2 id="deliverables" className="font-display text-xl font-bold">
            For your review
          </h2>
          <ul className="space-y-3">
            {project.deliverables.map((deliverable) => (
              <li key={deliverable.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{deliverable.title}</p>
                    <p className="text-sm text-muted-foreground">
                      Version {deliverable.version}
                      {deliverable.description ? ` · ${deliverable.description}` : ''}
                    </p>
                  </div>
                  <ToneBadge {...deliverableStatus(deliverable.status)} />
                </div>
                {deliverable.notes && <p className="mt-2 text-sm text-muted-foreground">{deliverable.notes}</p>}
                {deliverable.files.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {deliverable.files.map((file) => (
                      <Attachment key={file.id} file={file} />
                    ))}
                  </ul>
                )}
                {deliverable.links.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {deliverable.links.map((link, index) => (
                      <li key={index}>
                        <a href={link.url} target="_blank" rel="noreferrer" className="underline">
                          {link.label ?? link.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {deliverable.needsYou && <DeliverableActions deliverable={deliverable} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.changeRequests.length > 0 && (
        <section aria-labelledby="changes" className="space-y-3">
          <h2 id="changes" className="font-display text-xl font-bold">
            Changes to the work
          </h2>
          <ul className="space-y-3">
            {project.changeRequests.map((changeRequest) => (
              <li key={changeRequest.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {changeRequest.number ? `${changeRequest.number}: ` : ''}
                      {changeRequest.title}
                    </p>
                    <p className="text-sm text-muted-foreground">{changeRequest.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">
                      {formatMoney(changeRequest.impact.amountMinor, changeRequest.impact.currency as Currency)}
                    </p>
                    {changeRequest.impact.days > 0 && (
                      <p className="text-sm text-muted-foreground">
                        and {changeRequest.impact.days} day{changeRequest.impact.days === 1 ? '' : 's'}
                      </p>
                    )}
                    <ToneBadge {...changeRequestStatus(changeRequest.status)} />
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{changeRequest.reason}</p>
                {changeRequest.declineReason && (
                  <p className="mt-2 rounded-md border p-3 text-sm text-muted-foreground">
                    {changeRequest.declineReason}
                  </p>
                )}
                {changeRequest.status === 'sent' && changeRequest.needsSignature && (
                  <p className="mt-2 rounded-md border p-3 text-sm">
                    This change is agreed by signing it. Your signing link is in your email.
                  </p>
                )}
                {changeRequest.status === 'sent' && <ChangeRequestActions changeRequest={changeRequest} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.retainer && (
        <section aria-labelledby="retainer" className="space-y-3">
          <h2 id="retainer" className="font-display text-xl font-bold">
            Your hours
          </h2>
          <div className="rounded-lg border p-4">
            <p className="font-medium">
              {hours(project.retainer.usedMinutes)} of {hours(project.retainer.includedMinutes)} hours used
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDay(project.retainer.periodStart)} to {formatDay(project.retainer.periodEnd)} ·{' '}
              {project.retainer.overageMinutes > 0
                ? `${hours(project.retainer.overageMinutes)} hours beyond what is included`
                : `${hours(project.retainer.remainingMinutes)} left`}
            </p>
          </div>
        </section>
      )}

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
