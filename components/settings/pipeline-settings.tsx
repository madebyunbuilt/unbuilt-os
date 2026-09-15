'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatBpsAsPercent, parsePercentToBps } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';

type Stage = (typeof api.pipeline.stages._returnType)[number];
type Reason = (typeof api.pipeline.lostReasons._returnType)[number];

/** Deal stages and lost reasons. Shown only to deals.manage (Owner, Admins and project managers). */
export function PipelineSettings() {
  const stages = useQuery(api.pipeline.stages, {});
  const reasons = useQuery(api.pipeline.lostReasons, { includeInactive: true });
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-12">
      <section aria-labelledby="stages-heading" className="space-y-4">
        <div>
          <h3 id="stages-heading" className="font-display text-xl font-bold">
            Stages
          </h3>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Each open stage has a default chance to win, set on deals as they move into it. Won and Lost always come
            last. Changing a probability does not change existing deals.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {stages === undefined ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <ol className="divide-y rounded-lg border" aria-label="Stages">
            {stages.map((stage) => (
              <StageRow
                key={`${stage.id}-${stage.name}-${stage.probabilityBps}`}
                stage={stage}
                stages={stages}
                onError={setError}
              />
            ))}
          </ol>
        )}
        <NewStage onError={setError} />
      </section>

      <section aria-labelledby="reasons-heading" className="space-y-4">
        <div>
          <h3 id="reasons-heading" className="font-display text-xl font-bold">
            Lost reasons
          </h3>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Chosen when a deal is marked lost. Retired reasons stay on deals already lost with them.
          </p>
        </div>
        {reasons === undefined ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <ol className="divide-y rounded-lg border" aria-label="Lost reasons">
            {reasons.map((reason, index) => (
              <ReasonRow
                key={`${reason.id}-${reason.label}`}
                reason={reason}
                reasons={reasons}
                index={index}
                onError={setError}
              />
            ))}
          </ol>
        )}
        <NewReason onError={setError} />
      </section>
    </div>
  );
}

function StageRow({
  stage,
  stages,
  onError,
}: {
  stage: Stage;
  stages: Stage[];
  onError: (message: string | null) => void;
}) {
  const update = useMutation(api.pipeline.updateStage);
  const reorder = useMutation(api.pipeline.reorderStages);
  const remove = useMutation(api.pipeline.removeStage);
  const [name, setName] = useState(stage.name);
  const [probability, setProbability] = useState(formatBpsAsPercent(stage.probabilityBps));
  const [moveTo, setMoveTo] = useState('');
  const open = stages.filter((candidate) => candidate.kind === 'open');
  const position = open.findIndex((candidate) => candidate.id === stage.id);
  const changed = name !== stage.name || probability !== formatBpsAsPercent(stage.probabilityBps);

  async function run(action: () => Promise<unknown>) {
    onError(null);
    try {
      await action();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  const move = (offset: number) => {
    const ids = open.map((candidate) => candidate.id);
    const [moved] = ids.splice(position, 1);
    ids.splice(position + offset, 0, moved);
    void run(() => reorder({ openStageIds: ids }));
  };

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end" aria-label={stage.name}>
      <div className="flex-1 space-y-1">
        <Label htmlFor={`stage-name-${stage.id}`} className="text-xs text-muted-foreground">
          Name
        </Label>
        <Input id={`stage-name-${stage.id}`} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1 sm:w-28">
        <Label htmlFor={`stage-probability-${stage.id}`} className="text-xs text-muted-foreground">
          Win %
        </Label>
        {stage.kind === 'open' ? (
          <Input
            id={`stage-probability-${stage.id}`}
            inputMode="decimal"
            value={probability}
            onChange={(event) => setProbability(event.target.value)}
          />
        ) : (
          <p id={`stage-probability-${stage.id}`} className="flex h-9 items-center gap-2">
            {formatBpsAsPercent(stage.probabilityBps)}
            <ToneBadge label={stage.kind === 'won' ? 'Won' : 'Lost'} tone="muted" />
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={!changed}
          onClick={() =>
            void run(async () =>
              update({
                stageId: stage.id,
                name,
                probabilityBps: stage.kind === 'open' ? parsePercentToBps(probability) : stage.probabilityBps,
              }),
            )
          }
        >
          Save
        </Button>
        {stage.kind === 'open' && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Move ${stage.name} up`}
              disabled={position === 0}
              onClick={() => move(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Move ${stage.name} down`}
              disabled={position === open.length - 1}
              onClick={() => move(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" disabled={open.length === 1} aria-label={`Remove ${stage.name}`}>
                  Remove
                </Button>
              }
              title={`Remove the ${stage.name} stage?`}
              description={
                stage.dealCount > 0
                  ? `${stage.dealCount} ${stage.dealCount === 1 ? 'deal is' : 'deals are'} in this stage. Choose where they go.`
                  : 'No deals are in this stage.'
              }
              confirmLabel="Remove stage"
              canConfirm={stage.dealCount === 0 || !!moveTo}
              onConfirm={() =>
                remove({ stageId: stage.id, moveDealsTo: (moveTo || undefined) as Id<'pipelineStages'> | undefined })
              }
            >
              {stage.dealCount > 0 && (
                <div className="space-y-2">
                  <Label htmlFor={`stage-move-${stage.id}`}>Move its deals to</Label>
                  <NativeSelect
                    id={`stage-move-${stage.id}`}
                    value={moveTo}
                    onChange={(event) => setMoveTo(event.target.value)}
                  >
                    <option value="">Choose a stage</option>
                    {open
                      .filter((candidate) => candidate.id !== stage.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
              )}
            </ConfirmDialog>
          </>
        )}
      </div>
    </li>
  );
}

function NewStage({ onError }: { onError: (message: string | null) => void }) {
  const create = useMutation(api.pipeline.createStage);
  const [name, setName] = useState('');
  const [probability, setProbability] = useState('');
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      aria-label="Add a stage"
      onSubmit={async (event) => {
        event.preventDefault();
        onError(null);
        try {
          await create({ name, probabilityBps: parsePercentToBps(probability || '0') });
          setName('');
          setProbability('');
        } catch (error) {
          onError(errorMessage(error));
        }
      }}
    >
      <div className="flex-1 space-y-1">
        <Label htmlFor="new-stage-name">New stage</Label>
        <Input
          id="new-stage-name"
          value={name}
          placeholder="Such as Qualified"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-1 sm:w-28">
        <Label htmlFor="new-stage-probability">Win %</Label>
        <Input
          id="new-stage-probability"
          inputMode="decimal"
          value={probability}
          onChange={(event) => setProbability(event.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" disabled={!name.trim()}>
        <Plus aria-hidden />
        Add stage
      </Button>
    </form>
  );
}

function ReasonRow({
  reason,
  reasons,
  index,
  onError,
}: {
  reason: Reason;
  reasons: Reason[];
  index: number;
  onError: (message: string | null) => void;
}) {
  const update = useMutation(api.pipeline.updateLostReason);
  const setActive = useMutation(api.pipeline.setLostReasonActive);
  const reorder = useMutation(api.pipeline.reorderLostReasons);
  const [label, setLabel] = useState(reason.label);

  async function run(action: () => Promise<unknown>) {
    onError(null);
    try {
      await action();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  const move = (offset: number) => {
    const ids = reasons.map((candidate) => candidate.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + offset, 0, moved);
    void run(() => reorder({ reasonIds: ids }));
  };

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end" aria-label={reason.label}>
      <div className="flex-1 space-y-1">
        <Label htmlFor={`reason-${reason.id}`} className="text-xs text-muted-foreground">
          Reason
        </Label>
        <div className="flex items-center gap-2">
          <Input id={`reason-${reason.id}`} value={label} onChange={(event) => setLabel(event.target.value)} />
          {!reason.active && <ToneBadge label="Retired" tone="muted" />}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={label === reason.label}
          onClick={() => void run(() => update({ reasonId: reason.id, label }))}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move ${reason.label} up`}
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move ${reason.label} down`}
          disabled={index === reasons.length - 1}
          onClick={() => move(1)}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${reason.active ? 'Retire' : 'Bring back'} ${reason.label}`}
          onClick={() => void run(() => setActive({ reasonId: reason.id, active: !reason.active }))}
        >
          {reason.active ? 'Retire' : 'Bring back'}
        </Button>
      </div>
    </li>
  );
}

function NewReason({ onError }: { onError: (message: string | null) => void }) {
  const create = useMutation(api.pipeline.createLostReason);
  const [label, setLabel] = useState('');
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      aria-label="Add a lost reason"
      onSubmit={async (event) => {
        event.preventDefault();
        onError(null);
        try {
          await create({ label });
          setLabel('');
        } catch (error) {
          onError(errorMessage(error));
        }
      }}
    >
      <div className="flex-1 space-y-1">
        <Label htmlFor="new-reason">New lost reason</Label>
        <Input id="new-reason" value={label} onChange={(event) => setLabel(event.target.value)} />
      </div>
      <Button type="submit" variant="outline" disabled={!label.trim()}>
        <Plus aria-hidden />
        Add reason
      </Button>
    </form>
  );
}
