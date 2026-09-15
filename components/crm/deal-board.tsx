'use client';

import { useQuery } from 'convex/react';
import { CalendarClock, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Stage, StageSelect, useDealMove } from '@/components/crm/deal-stage-mover';
import { DealFormDialog } from '@/components/crm/deal-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatBpsAsPercent, formatMoney } from '@/convex/lib/money';
import { formatDay, stageTone } from '@/lib/crm-display';
import { cn } from '@/lib/utils';

type BoardStage = (typeof api.deals.board._returnType)[number];
type Deal = BoardStage['deals'][number];

const today = () => new Date().toISOString().slice(0, 10);

/** The pipeline as a board or a table, with value per currency. */
export function DealBoard({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const canManage = permissions.includes('deals.manage');
  const [view, setView] = useState<'board' | 'table'>('board');
  const [owner, setOwner] = useState<'all' | 'mine'>('all');
  const me = useQuery(api.team.me, {});
  const ownerMemberId = owner === 'mine' ? me?.id : undefined;
  const board = useQuery(api.deals.board, owner === 'mine' && !me ? 'skip' : { ownerMemberId });
  const summary = useQuery(api.deals.pipelineSummary, owner === 'mine' && !me ? 'skip' : { ownerMemberId });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Id<'deals'> | null>(null);
  const { request, dialog } = useDealMove({ onError: setError });
  const stages: Stage[] = board?.map(({ id, name, kind }) => ({ id, name, kind })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="View" className="flex gap-1">
          {(['board', 'table'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={view === option ? 'default' : 'outline'}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === 'board' ? 'Board' : 'Table'}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="deal-owner-filter" className="text-xs text-muted-foreground">
            Owner
          </Label>
          <NativeSelect
            id="deal-owner-filter"
            value={owner}
            onChange={(event) => setOwner(event.target.value as 'all' | 'mine')}
          >
            <option value="all">Everyone</option>
            <option value="mine">My deals</option>
          </NativeSelect>
        </div>
        {canManage && (
          <div className="sm:ml-auto">
            <DealFormDialog
              canPickOwner={permissions.includes('team.view')}
              onSaved={(dealId) => router.push(`/crm/deals/${dealId}`)}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  New deal
                </Button>
              }
            />
          </div>
        )}
      </div>

      <section aria-label="Pipeline value" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary === undefined ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : Object.keys(summary).length === 0 ? (
          <p className="text-sm text-muted-foreground">No open deals.</p>
        ) : (
          (Object.entries(summary) as [Currency, { count: number; valueMinor: number; weightedMinor: number }][]).map(
            ([currency, total]) => (
              <div key={currency} className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  {currency} pipeline · {total.count} open {total.count === 1 ? 'deal' : 'deals'}
                </p>
                <p className="mt-1 font-display text-2xl font-bold">{formatMoney(total.valueMinor, currency)}</p>
                <p className="text-sm text-muted-foreground">Weighted {formatMoney(total.weightedMinor, currency)}</p>
              </div>
            ),
          )
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
          {error}
        </p>
      )}
      {dialog}

      {board === undefined ? (
        <p className="text-muted-foreground">Loading the pipeline…</p>
      ) : view === 'board' ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <ol className="flex min-w-max gap-4" aria-label="Pipeline stages">
            {board.map((stage) => (
              <li
                key={stage.id}
                aria-label={stage.name}
                className={cn(
                  'flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/50 p-3',
                  dragging && 'outline-1 outline-dashed outline-border',
                )}
                onDragOver={(event) => {
                  if (canManage && dragging) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const deal = board.flatMap((s) => s.deals).find((d) => d.id === dragging);
                  setDragging(null);
                  if (deal && deal.stage?.id !== stage.id) void request(deal, stage);
                }}
              >
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <h2 className="font-medium">{stage.name}</h2>
                  <span className="text-sm text-muted-foreground">
                    {stage.kind === 'open' ? `${formatBpsAsPercent(stage.probabilityBps)}% · ` : ''}
                    {stage.deals.length}
                  </span>
                </div>
                {stage.kind !== 'open' && (
                  <p className="px-1 text-xs text-muted-foreground">Closed in the last 90 days</p>
                )}
                <ul className="flex flex-col gap-2">
                  {stage.deals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      stages={stages}
                      canManage={canManage}
                      onMove={(target) => void request(deal, target)}
                      onDragStart={() => setDragging(deal.id)}
                      onDragEnd={() => setDragging(null)}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <DealTable deals={board.flatMap((stage) => stage.deals)} />
      )}
    </div>
  );
}

function DealCard({
  deal,
  stages,
  canManage,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  deal: Deal;
  stages: Stage[];
  canManage: boolean;
  onMove: (stage: Stage) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const overdue = deal.nextFollowUpDate !== undefined && deal.nextFollowUpDate < today();
  return (
    <li
      draggable={canManage && deal.stage?.kind !== 'won'}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className="space-y-2 rounded-md border bg-background p-3 shadow-xs"
    >
      <Link href={`/crm/deals/${deal.id}`} className="block">
        <span className="block font-medium">{deal.title}</span>
        <span className="block text-sm text-muted-foreground">{deal.clientName}</span>
      </Link>
      <p className="font-display text-lg font-bold tabular-nums">{formatMoney(deal.valueMinor, deal.currency)}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{deal.ownerName}</span>
        {deal.nextFollowUpDate && (
          <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-foreground')}>
            <CalendarClock aria-hidden className="size-3.5" />
            {overdue ? 'Follow-up was ' : 'Follow up '}
            {formatDay(deal.nextFollowUpDate)}
          </span>
        )}
        {deal.lostReason && <span>{deal.lostReason}</span>}
      </div>
      {canManage && deal.stage?.kind !== 'won' && (
        <StageSelect
          id={`move-${deal.id}`}
          deal={{ id: deal.id, title: deal.title, stageId: deal.stage?.id }}
          stages={stages}
          onMove={onMove}
          label={`Move ${deal.title}`}
          hideLabel
        />
      )}
    </li>
  );
}

function DealTable({ deals }: { deals: Deal[] }) {
  if (deals.length === 0) return <p className="rounded-md border border-dashed p-6 text-muted-foreground">No deals.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[48rem] text-sm">
        <caption className="sr-only">Deals</caption>
        <thead className="bg-muted text-left">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Deal
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Stage
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Value
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Win
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Owner
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Expected close
            </th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-t hover:bg-accent/50">
              <td className="px-4 py-3">
                <Link href={`/crm/deals/${deal.id}`} className="block">
                  <span className="block font-medium">{deal.title}</span>
                  <span className="block text-muted-foreground">{deal.clientName}</span>
                </Link>
              </td>
              <td className="px-4 py-3">
                {deal.stage && <ToneBadge label={deal.stage.name} tone={stageTone(deal.stage.kind)} />}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatMoney(deal.valueMinor, deal.currency)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatBpsAsPercent(deal.probabilityBps)}%</td>
              <td className="px-4 py-3">{deal.ownerName}</td>
              <td className="px-4 py-3">{deal.expectedCloseDate ? formatDay(deal.expectedCloseDate) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
