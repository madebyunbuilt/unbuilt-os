'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DealFormDialog } from '@/components/crm/deal-form-dialog';
import { type Stage, StageSelect, useDealMove } from '@/components/crm/deal-stage-mover';
import { Timeline } from '@/components/crm/timeline';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { labelFor, SERVICE_LABELS } from '@/convex/lib/enquiries';
import { formatBpsAsPercent, formatMoney } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { formatDay, stageTone } from '@/lib/crm-display';

export function DealDetail({ dealId, permissions }: { dealId: Id<'deals'>; permissions: string[] }) {
  const router = useRouter();
  const deal = useQuery(api.deals.get, { dealId });
  const stages = useQuery(api.pipeline.stages, {});
  const [error, setError] = useState<string | null>(null);
  const { request, dialog } = useDealMove({ permissions, onError: setError });
  const canManage = permissions.includes('deals.manage');
  const remove = useMutation(api.deals.remove);

  if (deal === undefined) return <p className="text-muted-foreground">Loading…</p>;
  const stageOptions: Stage[] = stages?.map(({ id, name, kind }) => ({ id, name, kind })) ?? [];

  return (
    <div className="space-y-8">
      <Link
        href="/crm/deals"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Deals
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold">{deal.title}</h1>
            {deal.stage && <ToneBadge label={deal.stage.name} tone={stageTone(deal.stage.kind)} />}
          </div>
          <p className="mt-1 text-muted-foreground">
            {permissions.includes('clients.view') ? (
              <Link href={`/crm/clients/${deal.clientId}`} className="underline underline-offset-4">
                {deal.clientName}
              </Link>
            ) : (
              deal.clientName
            )}
            {' · '}Owner: {deal.ownerName}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2 sm:ml-auto">
            <DealFormDialog
              deal={deal}
              canPickOwner={permissions.includes('team.view')}
              trigger={
                <Button variant="outline">
                  <Pencil aria-hidden />
                  Edit
                </Button>
              }
            />
            {permissions.includes('clients.delete') && (
              <ConfirmDialog
                trigger={<Button variant="ghost">Delete</Button>}
                title={`Delete ${deal.title}?`}
                description="For a deal entered by mistake. Its timeline is deleted too, and an enquiry converted into it goes back to reviewed."
                confirmLabel="Delete"
                onConfirm={async () => {
                  await remove({ dealId });
                  router.push('/crm/deals');
                }}
              />
            )}
          </div>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
          {error}
        </p>
      )}
      {dialog}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="deal-timeline-heading" className="min-w-0 space-y-4">
          <h2 id="deal-timeline-heading" className="font-display text-xl font-bold">
            Timeline
          </h2>
          <Timeline
            subject={{ table: 'deals', id: dealId }}
            canAdd={permissions.includes('deals.view')}
            canMention={permissions.includes('team.view')}
          />
        </section>

        <aside className="space-y-6">
          <section aria-labelledby="deal-summary-heading" className="space-y-3 rounded-lg border p-4">
            <h2 id="deal-summary-heading" className="sr-only">
              Summary
            </h2>
            <p className="font-display text-3xl font-bold tabular-nums">
              {formatMoney(deal.valueMinor, deal.currency)}
            </p>
            <p className="text-sm text-muted-foreground">{formatBpsAsPercent(deal.probabilityBps)}% chance to win</p>
            {canManage && deal.stage?.kind !== 'won' && stages && (
              <StageSelect
                id="deal-stage"
                deal={{ id: deal.id, title: deal.title, stageId: deal.stage?.id }}
                stages={stageOptions}
                onMove={(stage) => void request(deal, stage)}
              />
            )}
            {deal.stage?.kind === 'won' && <WonProject dealId={dealId} />}
            {deal.stage?.kind === 'lost' && (
              <p className="text-sm">
                Lost
                {deal.lostAt
                  ? ` on ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(deal.lostAt)}`
                  : ''}
                : {deal.lostReason}
                {deal.lostNote ? `. ${deal.lostNote}` : ''}
              </p>
            )}
          </section>

          {canManage && <FollowUp dealId={dealId} date={deal.nextFollowUpDate} />}

          <section aria-labelledby="deal-details-heading" className="space-y-3 rounded-lg border p-4">
            <h2 id="deal-details-heading" className="font-display text-lg font-bold">
              Details
            </h2>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Contact</dt>
              <dd>{deal.primaryContact ? `${deal.primaryContact.name} (${deal.primaryContact.email})` : '—'}</dd>
              <dt className="text-muted-foreground">Expected close</dt>
              <dd>{deal.expectedCloseDate ? formatDay(deal.expectedCloseDate) : '—'}</dd>
              {!canManage && (
                <>
                  <dt className="text-muted-foreground">Follow-up</dt>
                  <dd>{deal.nextFollowUpDate ? formatDay(deal.nextFollowUpDate) : '—'}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Services</dt>
              <dd>{deal.services.map((slug) => labelFor(SERVICE_LABELS, slug)).join(', ') || '—'}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                {deal.source ?? '—'}
                {deal.enquiryId && permissions.includes('enquiries.view') && (
                  <>
                    {' · '}
                    <Link href={`/crm/enquiries/${deal.enquiryId}`} className="underline underline-offset-4">
                      Enquiry
                    </Link>
                  </>
                )}
              </dd>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** The project a won deal became. Someone off the project sees its name but no link. */
function WonProject({ dealId }: { dealId: Id<'deals'> }) {
  const project = useQuery(api.projects.forDeal, { dealId });
  if (!project) return null;
  return (
    <p className="text-sm">
      Won as{' '}
      {project.id ? (
        <Link href={`/projects/${project.id}`} className="underline underline-offset-4">
          {project.code} {project.name}
        </Link>
      ) : (
        `${project.code} ${project.name}`
      )}
    </p>
  );
}

function FollowUp({ dealId, date }: { dealId: Id<'deals'>; date?: string }) {
  const setFollowUp = useMutation(api.deals.setFollowUp);
  const [value, setValue] = useState(date ?? '');
  const [status, setStatus] = useState<string | null>(null);

  async function save(next: string | undefined) {
    setStatus(null);
    try {
      await setFollowUp({ dealId, date: next });
      setValue(next ?? '');
      setStatus(next ? `Follow-up set for ${formatDay(next)}.` : 'Follow-up cleared.');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  return (
    <section aria-labelledby="follow-up-heading" className="space-y-3 rounded-lg border p-4">
      <h2 id="follow-up-heading" className="font-display text-lg font-bold">
        Next follow-up
      </h2>
      <p className="text-sm text-muted-foreground">
        The owner is reminded if the date passes with nothing logged, or after 7 quiet days with no follow-up planned.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="follow-up-date" className="sr-only">
            Follow-up date
          </Label>
          <Input id="follow-up-date" type="date" value={value} onChange={(event) => setValue(event.target.value)} />
        </div>
        <Button variant="outline" disabled={!value || value === date} onClick={() => void save(value)}>
          Set
        </Button>
        {date && (
          <Button variant="ghost" onClick={() => void save(undefined)}>
            Clear
          </Button>
        )}
      </div>
      <p aria-live="polite" className="text-sm">
        {status}
      </p>
    </section>
  );
}
