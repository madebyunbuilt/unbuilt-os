'use client';

import { useMutation } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { errorMessage } from '@/lib/convex-error';
import { parseHoursToMinutes, toHoursInput } from '@/lib/projects-display';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type TaskPriority, TASK_STATUS_LABELS } from '@/lib/tasks-display';

// Adding and editing a task (06-projects.md, Tasks). Only project members can be assigned, so the list comes from the
// project itself rather than the whole team.

type Task = (typeof api.tasks.listForProject._returnType)[number];
type Milestone = { id: Id<'milestones'>; name: string };
type Member = { memberId: Id<'teamMembers'>; name: string };

export function TaskFormDialog({
  projectId,
  task,
  status,
  milestones,
  members,
  trigger,
}: {
  projectId: Id<'projects'>;
  task?: Task;
  /** The column a new task starts in. */
  status?: keyof typeof TASK_STATUS_LABELS;
  milestones: Milestone[];
  members: Member[];
  trigger: ReactNode;
}) {
  const create = useMutation(api.tasks.create);
  const update = useMutation(api.tasks.update);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [milestoneId, setMilestoneId] = useState<string>(task?.milestone?.id ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium');
  const [assignees, setAssignees] = useState<string[]>(task?.assignees.map((person) => person.id) ?? []);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [estimate, setEstimate] = useState(toHoursInput(task?.estimateMinutes));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = task ? `task-form-${task.id}` : 'task-form-new';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{task ? `Edit ${task.title}` : 'New task'}</DialogTitle>
          <DialogDescription>
            {task
              ? 'Move it between columns on the board.'
              : `It starts in ${TASK_STATUS_LABELS[status ?? 'todo'].toLowerCase()}. Only project members can be assigned.`}
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
                title,
                description: description || undefined,
                milestoneId: (milestoneId || undefined) as Id<'milestones'> | undefined,
                priority,
                assigneeMemberIds: assignees as Id<'teamMembers'>[],
                dueDate: dueDate || undefined,
                estimateMinutes: parseHoursToMinutes(estimate),
              };
              if (task) await update({ taskId: task.id, ...fields });
              else await create({ projectId, status, ...fields });
              setOpen(false);
              if (!task) {
                setTitle('');
                setDescription('');
                setAssignees([]);
                setDueDate('');
                setEstimate('');
              }
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-priority`}>Priority</Label>
              <NativeSelect
                id={`${formId}-priority`}
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
              >
                {TASK_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {TASK_PRIORITY_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-milestone`}>Milestone</Label>
              <NativeSelect
                id={`${formId}-milestone`}
                value={milestoneId}
                onChange={(event) => setMilestoneId(event.target.value)}
              >
                <option value="">No milestone</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
              </NativeSelect>
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
              <Label htmlFor={`${formId}-estimate`}>Estimate in hours (optional)</Label>
              <Input
                id={`${formId}-estimate`}
                inputMode="decimal"
                placeholder="1.5"
                value={estimate}
                onChange={(event) => setEstimate(event.target.value)}
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Assignees</legend>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add people to the project first.</p>
            ) : (
              <ul className="space-y-2">
                {members.map((member) => (
                  <li key={member.memberId} className="flex items-center gap-2">
                    <Checkbox
                      id={`${formId}-assignee-${member.memberId}`}
                      checked={assignees.includes(member.memberId)}
                      onCheckedChange={(checked) =>
                        setAssignees((current) =>
                          checked ? [...current, member.memberId] : current.filter((id) => id !== member.memberId),
                        )
                      }
                    />
                    <Label htmlFor={`${formId}-assignee-${member.memberId}`} className="font-normal">
                      {member.name}
                    </Label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
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
            {saving ? 'Saving…' : task ? 'Save task' : 'Add task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
