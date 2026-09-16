'use client';

import { useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
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
import { type Currency, parseMoneyInput } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { toAmountInput } from '@/lib/crm-display';
import { BILLING_MODEL_LABELS, PROJECT_TYPE_LABELS } from '@/lib/projects-display';

type Project = NonNullable<typeof api.projects.get._returnType>;
type Deal = { id: Id<'deals'>; title: string; clientId: Id<'clients'>; currency: Currency; valueMinor: number };

type Values = {
  clientId: string;
  templateId: string;
  name: string;
  type: keyof typeof PROJECT_TYPE_LABELS;
  billingModel: keyof typeof BILLING_MODEL_LABELS;
  currency: Currency;
  budget: string;
  startDate: string;
  dueDate: string;
  managerMemberId: string;
  description: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const toValues = (project: Project | undefined, clientId: string | undefined, deal: Deal | undefined): Values => ({
  clientId: project?.clientId ?? deal?.clientId ?? clientId ?? '',
  templateId: '',
  name: project?.name ?? deal?.title ?? '',
  type: project?.type ?? 'web_platform',
  billingModel: project?.billingModel ?? 'fixed',
  currency: project?.currency ?? deal?.currency ?? 'NGN',
  budget: toAmountInput(project?.budgetMinor ?? deal?.valueMinor),
  startDate: project?.startDate ?? today(),
  dueDate: project?.dueDate ?? '',
  managerMemberId: project?.managerMemberId ?? '',
  description: project?.description ?? '',
});

/**
 * Creates a project (blank or from a template) or edits one. With `deal`, creating it also marks that deal won, and
 * the form starts from the deal's title, currency and value.
 */
export function ProjectFormDialog({
  trigger,
  project,
  clientId,
  deal,
  canPickManager,
  onSaved,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactNode;
  project?: Project;
  clientId?: Id<'clients'>;
  deal?: Deal;
  canPickManager: boolean;
  onSaved?: (projectId: Id<'projects'>) => void;
  /** Controlled use, for the flow that wins a deal. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [values, setValues] = useState<Values>(() => toValues(project, clientId, deal));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.projects.create);
  const update = useMutation(api.projects.update);
  const winWithNew = useMutation(api.projects.winDealWithNewProject);
  const clients = useQuery(api.clients.list, open && !project && !clientId ? {} : 'skip');
  const templates = useQuery(api.projectTemplates.list, open && !project ? {} : 'skip');
  const team = useQuery(api.team.list, open && canPickManager ? {} : 'skip');
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const formId = project ? `project-form-${project.id}` : 'project-form-new';
  const template = templates?.find((candidate) => candidate.id === values.templateId);

  async function save() {
    if (!project && !values.clientId) {
      setError('Choose the client this project is for');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const common = {
        name: values.name,
        type: values.type,
        billingModel: values.billingModel,
        currency: values.currency,
        budgetMinor: values.budget.trim() ? parseMoneyInput(values.budget, values.currency) : undefined,
        startDate: values.startDate,
        dueDate: values.dueDate || undefined,
        managerMemberId: (values.managerMemberId || undefined) as Id<'teamMembers'> | undefined,
        description: values.description || undefined,
      };
      let projectId: Id<'projects'>;
      if (project) {
        await update({ projectId: project.id, ...common, slaPolicyId: project.slaPolicyId, links: project.links });
        projectId = project.id;
      } else if (deal) {
        projectId = await winWithNew({
          dealId: deal.id,
          templateId: (values.templateId || undefined) as Id<'projectTemplates'> | undefined,
          ...common,
        });
      } else {
        projectId = await create({
          clientId: values.clientId as Id<'clients'>,
          templateId: (values.templateId || undefined) as Id<'projectTemplates'> | undefined,
          ...common,
        });
      }
      setOpen(false);
      onSaved?.(projectId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValues(toValues(project, clientId, deal));
        setError(null);
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            {project ? `Edit ${project.name}` : deal ? `Win ${deal.title}` : 'New project'}
          </DialogTitle>
          <DialogDescription>
            {project
              ? 'Milestones, deliverables and members are managed on the project page.'
              : deal
                ? 'Winning a deal creates its project. Pick a template to start with its milestones and tasks.'
                : 'New projects start in planning. A template adds its milestones, deliverables and tasks.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {!project && !clientId && !deal && (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-client`}>Client</Label>
              <NativeSelect
                id={`${formId}-client`}
                value={values.clientId}
                disabled={!clients}
                aria-invalid={error !== null && !values.clientId ? true : undefined}
                onChange={(event) => set('clientId', event.target.value)}
              >
                <option value="">{clients ? 'Choose a client' : 'Loading clients…'}</option>
                {clients?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.displayName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {!project && (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-template`}>Template (optional)</Label>
              <NativeSelect
                id={`${formId}-template`}
                value={values.templateId}
                onChange={(event) => {
                  const chosen = templates?.find((candidate) => candidate.id === event.target.value);
                  setValues((current) => ({
                    ...current,
                    templateId: event.target.value,
                    type: (chosen?.type as Values['type']) ?? current.type,
                    name: current.name || chosen?.name || '',
                  }));
                }}
              >
                <option value="">Start blank</option>
                {templates?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect>
              {template && (
                <p className="text-sm text-muted-foreground">
                  {template.milestones.length} milestones,{' '}
                  {template.milestones.reduce((sum, milestone) => sum + milestone.deliverables.length, 0)} deliverables
                  and {template.tasks.length} tasks, dated from the start.
                </p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input id={`${formId}-name`} value={values.name} onChange={(event) => set('name', event.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-type`}>Type</Label>
              <NativeSelect
                id={`${formId}-type`}
                value={values.type}
                onChange={(event) => set('type', event.target.value as Values['type'])}
              >
                {Object.entries(PROJECT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-billing`}>Billing</Label>
              <NativeSelect
                id={`${formId}-billing`}
                value={values.billingModel}
                onChange={(event) => set('billingModel', event.target.value as Values['billingModel'])}
              >
                {Object.entries(BILLING_MODEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-budget`}>Budget (optional)</Label>
              <Input
                id={`${formId}-budget`}
                inputMode="decimal"
                value={values.budget}
                onChange={(event) => set('budget', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-currency`}>Currency</Label>
              <NativeSelect
                id={`${formId}-currency`}
                value={values.currency}
                onChange={(event) => set('currency', event.target.value as Currency)}
              >
                <option value="NGN">NGN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-start`}>Start date</Label>
              <Input
                id={`${formId}-start`}
                type="date"
                value={values.startDate}
                onChange={(event) => set('startDate', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-due`}>Due date (optional)</Label>
              <Input
                id={`${formId}-due`}
                type="date"
                value={values.dueDate}
                placeholder={template ? 'From the template' : undefined}
                onChange={(event) => set('dueDate', event.target.value)}
              />
            </div>
          </div>
          {canPickManager && (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-manager`}>Project manager</Label>
              <NativeSelect
                id={`${formId}-manager`}
                value={values.managerMemberId}
                disabled={!team}
                onChange={(event) => set('managerMemberId', event.target.value)}
              >
                <option value="">{project ? 'Keep the current manager' : 'Me'}</option>
                {team
                  ?.filter((member) => member.status === 'active')
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">The manager is always a member of the project.</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${formId}-description`}>Description (optional)</Label>
            <Textarea
              id={`${formId}-description`}
              rows={3}
              value={values.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={saving || !values.name.trim()}>
            {saving ? 'Saving…' : project ? 'Save project' : deal ? 'Win the deal' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
