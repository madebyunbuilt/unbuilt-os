'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { WinDealDialog, type WinnableDeal } from '@/components/projects/win-deal-dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

export type Stage = { id: Id<'pipelineStages'>; name: string; kind: 'open' | 'won' | 'lost' };

/**
 * Moves a deal to another stage. Won asks for the project the deal becomes; Lost asks for a reason. Returns the
 * control and, while either is pending, its dialog. Other moves happen at once.
 */
export function useDealMove({
  permissions,
  onError,
}: {
  permissions: string[];
  onError: (message: string | null) => void;
}) {
  const move = useMutation(api.deals.moveToStage);
  const reasons = useQuery(api.pipeline.lostReasons, {});
  const [pendingLost, setPendingLost] = useState<{ dealId: Id<'deals'>; title: string; stage: Stage } | null>(null);
  const [pendingWin, setPendingWin] = useState<WinnableDeal | null>(null);
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');

  async function request(deal: WinnableDeal, stage: Stage) {
    onError(null);
    if (stage.kind === 'won') {
      setPendingWin(deal);
      return;
    }
    if (stage.kind === 'lost') {
      setReasonId('');
      setNote('');
      setPendingLost({ dealId: deal.id, title: deal.title, stage });
      return;
    }
    try {
      await move({ dealId: deal.id, stageId: stage.id });
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  const lostDialog = pendingLost && (
    <ConfirmDialog
      key={pendingLost.dealId}
      open
      onOpenChange={(open) => {
        if (!open) setPendingLost(null);
      }}
      title={`Mark ${pendingLost.title} as lost?`}
      description="Choose why. Lost deals can be reopened later."
      confirmLabel="Mark as lost"
      canConfirm={!!reasonId}
      onConfirm={async () => {
        await move({
          dealId: pendingLost.dealId,
          stageId: pendingLost.stage.id,
          lostReasonId: reasonId as Id<'lostReasons'>,
          lostNote: note || undefined,
        });
        setPendingLost(null);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="lost-reason">Reason</Label>
        <NativeSelect id="lost-reason" value={reasonId} onChange={(event) => setReasonId(event.target.value)}>
          <option value="">Choose a reason</option>
          {reasons?.map((reason) => (
            <option key={reason.id} value={reason.id}>
              {reason.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="lost-note">Note (optional)</Label>
        <Textarea id="lost-note" value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
    </ConfirmDialog>
  );

  const winDialog = pendingWin && (
    <WinDealDialog
      key={pendingWin.id}
      deal={pendingWin}
      canCreateProject={permissions.includes('projects.create')}
      canPickManager={permissions.includes('team.view')}
      open
      onOpenChange={(open) => {
        if (!open) setPendingWin(null);
      }}
    />
  );

  return {
    request,
    dialog: (
      <>
        {lostDialog}
        {winDialog}
      </>
    ),
  };
}

/** A "Move to" select for a deal. Keyboard and screen-reader friendly alternative to dragging on the board. */
export function StageSelect({
  id,
  deal,
  stages,
  onMove,
  label = 'Stage',
  hideLabel = false,
}: {
  id: string;
  deal: { id: Id<'deals'>; title: string; stageId?: Id<'pipelineStages'> };
  stages: Stage[];
  onMove: (stage: Stage) => void;
  label?: string;
  hideLabel?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </Label>
      <NativeSelect
        id={id}
        value={deal.stageId ?? ''}
        onChange={(event) => {
          const stage = stages.find((candidate) => candidate.id === event.target.value);
          if (stage) onMove(stage);
        }}
      >
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
