'use client';

import { useMutation, useQuery } from 'convex/react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatBpsAsPercent, formatMoney, parseMoneyInput, parsePercentToBps } from '@/convex/lib/money';
import { CLOSED_PROJECT_STATUSES } from '@/convex/lib/projectStatus';
import { errorMessage } from '@/lib/convex-error';
import { formatDay, toAmountInput } from '@/lib/crm-display';
import { deliverableStatus, milestoneStatus } from '@/lib/projects-display';

// Milestones and their deliverables (06-projects.md). The team plans them; approval comes from the client in the
// portal, and invoiced comes from billing, so neither can be set here.

type Milestones = typeof api.milestones.listForProject._returnType;
type Milestone = Milestones['milestones'][number];
type Deliverable = Milestone['deliverables'][number];

const MANUAL_STATUSES = ['upcoming', 'in_progress', 'skipped'] as const;

export function MilestonesPanel({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const project = useQuery(api.projects.get, { projectId });
  const data = useQuery(api.milestones.listForProject, { projectId });
  const reorder = useMutation(api.milestones.reorder);

  if (data === undefined || project === undefined) return <p className="text-muted-foreground">Loading milestones…</p>;

  const currency = project.currency;
  const isOpen = !CLOSED_PROJECT_STATUSES.has(project.status);
  const canEdit = permissions.includes('projects.update');
  const canManageDeliverables = permissions.includes('deliverables.manage.assigned');

  const move = async (index: number, by: number) => {
    const ids = data.milestones.map((milestone) => milestone.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorder({ projectId, milestoneIds: ids });
  };

  return (
    <div className="space-y-6">
      {canEdit && isOpen && (
        <div className="flex flex-wrap gap-2">
          <MilestoneFormDialog
            projectId={projectId}
            currency={currency}
            trigger={
              <Button>
                <Plus aria-hidden />
                New milestone
              </Button>
            }
          />
          {canManageDeliverables && (
            <DeliverableFormDialog
              projectId={projectId}
              milestones={data.milestones}
              trigger={<Button variant="outline">Add a deliverable</Button>}
            />
          )}
        </div>
      )}

      {data.milestones.length === 0 && data.unassigned.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          No milestones yet. A project created from a template starts with them.
        </p>
      ) : (
        <ol className="space-y-4">
          {data.milestones.map((milestone, index) => (
            <li key={milestone.id} className="rounded-lg border p-4">
              <MilestoneCard
                projectId={projectId}
                milestone={milestone}
                milestones={data.milestones}
                currency={currency}
                canEdit={canEdit && isOpen}
                canManageDeliverables={canManageDeliverables && isOpen}
                onMoveUp={index === 0 ? undefined : () => move(index, -1)}
                onMoveDown={index === data.milestones.length - 1 ? undefined : () => move(index, 1)}
              />
            </li>
          ))}
        </ol>
      )}

      {data.unassigned.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">Without a milestone</h2>
          <ul className="space-y-2">
            {data.unassigned.map((deliverable) => (
              <li key={deliverable.id}>
                <DeliverableRow projectId={projectId} deliverable={deliverable} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function billingLabel(milestone: Milestone, currency: Currency) {
  if (milestone.billingAmountMinor !== undefined) return formatMoney(milestone.billingAmountMinor, currency);
  if (milestone.billingPercentBps !== undefined)
    return `${formatBpsAsPercent(milestone.billingPercentBps)}% of the project`;
  return null;
}

function MilestoneCard({
  projectId,
  milestone,
  milestones,
  currency,
  canEdit,
  canManageDeliverables,
  onMoveUp,
  onMoveDown,
}: {
  projectId: Id<'projects'>;
  milestone: Milestone;
  milestones: Milestone[];
  currency: Currency;
  canEdit: boolean;
  canManageDeliverables: boolean;
  onMoveUp?: () => Promise<void>;
  onMoveDown?: () => Promise<void>;
}) {
  const setStatus = useMutation(api.milestones.setStatus);
  const remove = useMutation(api.milestones.remove);
  const [error, setError] = useState<string | null>(null);
  const settled = milestone.status === 'approved' || milestone.status === 'invoiced';
  const billing = billingLabel(milestone, currency);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{milestone.name}</h2>
            <ToneBadge {...milestoneStatus(milestone.status)} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[milestone.dueDate ? `Due ${formatDay(milestone.dueDate)}` : 'No due date', billing]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
          {canEdit && (
            <>
              {onMoveUp && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${milestone.name} up`}
                  onClick={() => void onMoveUp()}
                >
                  <ChevronUp aria-hidden />
                </Button>
              )}
              {onMoveDown && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${milestone.name} down`}
                  onClick={() => void onMoveDown()}
                >
                  <ChevronDown aria-hidden />
                </Button>
              )}
              {!settled && (
                <>
                  <label className="sr-only" htmlFor={`milestone-status-${milestone.id}`}>
                    Status of {milestone.name}
                  </label>
                  <NativeSelect
                    id={`milestone-status-${milestone.id}`}
                    className="w-auto"
                    value={
                      MANUAL_STATUSES.includes(milestone.status as (typeof MANUAL_STATUSES)[number])
                        ? milestone.status
                        : ''
                    }
                    onChange={async (event) => {
                      setError(null);
                      try {
                        await setStatus({
                          milestoneId: milestone.id,
                          status: event.target.value as (typeof MANUAL_STATUSES)[number],
                        });
                      } catch (caught) {
                        setError(errorMessage(caught));
                      }
                    }}
                  >
                    {!MANUAL_STATUSES.includes(milestone.status as (typeof MANUAL_STATUSES)[number]) && (
                      <option value="">{milestoneStatus(milestone.status).label}</option>
                    )}
                    <option value="upcoming">Upcoming</option>
                    <option value="in_progress">In progress</option>
                    <option value="skipped">Skipped</option>
                  </NativeSelect>
                  <MilestoneFormDialog
                    projectId={projectId}
                    currency={currency}
                    milestone={milestone}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    }
                  />
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        Delete
                      </Button>
                    }
                    title={`Delete ${milestone.name}?`}
                    description="Its deliverables and tasks stay on the project, without a milestone."
                    confirmLabel="Delete"
                    onConfirm={() => remove({ milestoneId: milestone.id })}
                  />
                </>
              )}
            </>
          )}
          {canManageDeliverables && !settled && (
            <DeliverableFormDialog
              projectId={projectId}
              milestones={milestones}
              milestoneId={milestone.id}
              trigger={
                <Button variant="ghost" size="sm">
                  Add a deliverable
                </Button>
              }
            />
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {milestone.deliverables.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deliverables yet.</p>
      ) : (
        <ul className="space-y-2">
          {milestone.deliverables.map((deliverable) => (
            <li key={deliverable.id}>
              <DeliverableRow projectId={projectId} deliverable={deliverable} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeliverableRow({ projectId, deliverable }: { projectId: Id<'projects'>; deliverable: Deliverable }) {
  return (
    <Link
      href={`/projects/${projectId}/deliverables/${deliverable.id}`}
      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
    >
      <span className="font-medium">{deliverable.title}</span>
      <span className="text-muted-foreground">
        {deliverable.currentVersion === 0 ? 'No version yet' : `Version ${deliverable.currentVersion}`}
      </span>
      <span className="sm:ml-auto">
        <ToneBadge {...deliverableStatus(deliverable.status)} />
      </span>
    </Link>
  );
}

function MilestoneFormDialog({
  projectId,
  milestone,
  currency,
  trigger,
}: {
  projectId: Id<'projects'>;
  milestone?: Milestone;
  currency: Currency;
  trigger: ReactNode;
}) {
  const create = useMutation(api.milestones.create);
  const update = useMutation(api.milestones.update);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(milestone?.name ?? '');
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? '');
  const [billing, setBilling] = useState<'none' | 'amount' | 'percent'>(
    milestone?.billingAmountMinor !== undefined
      ? 'amount'
      : milestone?.billingPercentBps !== undefined
        ? 'percent'
        : 'none',
  );
  const [amount, setAmount] = useState(toAmountInput(milestone?.billingAmountMinor));
  const [percent, setPercent] = useState(
    milestone?.billingPercentBps === undefined ? '' : formatBpsAsPercent(milestone.billingPercentBps),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = milestone ? `milestone-form-${milestone.id}` : 'milestone-form-new';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">{milestone ? `Edit ${milestone.name}` : 'New milestone'}</DialogTitle>
          <DialogDescription>
            A billing amount or percentage feeds the billing schedule when invoicing arrives.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            try {
              const fields = {
                name,
                dueDate: dueDate || undefined,
                billingAmountMinor:
                  billing === 'amount' && amount.trim() ? parseMoneyInput(amount, currency) : undefined,
                billingPercentBps: billing === 'percent' && percent.trim() ? parsePercentToBps(percent) : undefined,
              };
              if (milestone) await update({ milestoneId: milestone.id, ...fields });
              else await create({ projectId, ...fields });
              setOpen(false);
              if (!milestone) {
                setName('');
                setDueDate('');
                setAmount('');
                setPercent('');
                setBilling('none');
              }
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input id={`${formId}-name`} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-due`}>Due date (optional)</Label>
            <Input
              id={`${formId}-due`}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-billing`}>Billing</Label>
            <NativeSelect
              id={`${formId}-billing`}
              value={billing}
              onChange={(event) => setBilling(event.target.value as typeof billing)}
            >
              <option value="none">Not billed on this milestone</option>
              <option value="amount">A fixed amount</option>
              <option value="percent">A percentage of the project</option>
            </NativeSelect>
          </div>
          {billing === 'amount' && (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-amount`}>Amount ({currency})</Label>
              <Input
                id={`${formId}-amount`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          )}
          {billing === 'percent' && (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-percent`}>Percentage</Label>
              <Input
                id={`${formId}-percent`}
                inputMode="decimal"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : milestone ? 'Save milestone' : 'Add milestone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeliverableFormDialog({
  projectId,
  milestones,
  milestoneId,
  trigger,
}: {
  projectId: Id<'projects'>;
  milestones: Milestone[];
  milestoneId?: Id<'milestones'>;
  trigger: ReactNode;
}) {
  const create = useMutation(api.deliverables.create);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chosen, setChosen] = useState<string>(milestoneId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = `deliverable-form-${milestoneId ?? 'any'}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
        if (next) setChosen(milestoneId ?? '');
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">New deliverable</DialogTitle>
          <DialogDescription>
            Deliverables start as a draft. Submitting a version sends it to the client for review.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            try {
              await create({
                projectId,
                title,
                description: description || undefined,
                milestoneId: (chosen || undefined) as Id<'milestones'> | undefined,
              });
              setOpen(false);
              setTitle('');
              setDescription('');
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${formId}-title`}>Title</Label>
            <Input id={`${formId}-title`} value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-milestone`}>Milestone</Label>
            <NativeSelect id={`${formId}-milestone`} value={chosen} onChange={(event) => setChosen(event.target.value)}>
              <option value="">No milestone</option>
              {milestones
                .filter((milestone) => milestone.status !== 'approved' && milestone.status !== 'invoiced')
                .map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-description`}>Description (optional)</Label>
            <Textarea
              id={`${formId}-description`}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Add deliverable'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
