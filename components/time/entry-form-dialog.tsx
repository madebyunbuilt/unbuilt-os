'use client';

import { useMutation, useQuery } from 'convex/react';
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
import { formatDuration, parseDurationToMinutes } from '@/lib/time-display';

// Logging and editing your own time (06-projects.md, Time tracking). Editing a submitted entry puts it back in draft,
// which the dialog says before saving.

type Entry = (typeof api.time.myWeek._returnType)['entries'][number];

export function EntryFormDialog({
  trigger,
  entry,
  date,
  projectId,
  onSaved,
}: {
  trigger: ReactNode;
  entry?: Entry;
  /** The day a new entry starts on. */
  date?: string;
  /** Fixed project, on a project's Time tab. */
  projectId?: Id<'projects'>;
  onSaved?: () => void;
}) {
  const log = useMutation(api.time.log);
  const update = useMutation(api.time.update);
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<string>(entry?.projectId ?? projectId ?? '');
  const [taskId, setTaskId] = useState<string>(entry?.taskId ?? '');
  const [day, setDay] = useState(entry?.date ?? date ?? '');
  const [duration, setDuration] = useState(entry ? formatDuration(entry.minutes) : '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const projects = useQuery(api.time.myRecentProjects, open && !projectId ? {} : 'skip');
  const tasks = useQuery(api.tasks.listForProject, open && project ? { projectId: project as Id<'projects'> } : 'skip');
  const formId = entry ? `time-entry-${entry.id}` : `time-entry-new-${date ?? 'any'}`;

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
          <DialogTitle className="font-display">{entry ? 'Edit this entry' : 'Log time'}</DialogTitle>
          <DialogDescription>
            {entry?.status === 'submitted'
              ? 'This entry is waiting for approval. Changing it puts it back in your drafts.'
              : 'Hours as you like them: 1.5, 1:30 or 1h 30m.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!project) {
              setError('Choose the project this time is for');
              return;
            }
            setSaving(true);
            setError(null);
            try {
              const fields = {
                projectId: project as Id<'projects'>,
                taskId: (taskId || undefined) as Id<'tasks'> | undefined,
                date: day,
                minutes: parseDurationToMinutes(duration),
                description,
                billable,
              };
              if (entry) await update({ entryId: entry.id, ...fields });
              else await log(fields);
              setOpen(false);
              if (!entry) {
                setDuration('');
                setDescription('');
                setTaskId('');
              }
              onSaved?.();
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          {!projectId && (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-project`}>Project</Label>
              <NativeSelect
                id={`${formId}-project`}
                value={project}
                disabled={!projects}
                aria-invalid={error !== null && !project ? true : undefined}
                onChange={(event) => {
                  setProject(event.target.value);
                  setTaskId('');
                }}
              >
                <option value="">{projects ? 'Choose a project' : 'Loading projects…'}</option>
                {projects?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${formId}-task`}>Task (optional)</Label>
            <NativeSelect
              id={`${formId}-task`}
              value={taskId}
              disabled={!project}
              onChange={(event) => setTaskId(event.target.value)}
            >
              <option value="">No task</option>
              {tasks?.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-date`}>Date</Label>
              <Input id={`${formId}-date`} type="date" value={day} onChange={(event) => setDay(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-duration`}>How long</Label>
              <Input
                id={`${formId}-duration`}
                placeholder="1:30"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-description`}>What you did</Label>
            <Textarea
              id={`${formId}-description`}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${formId}-billable`}
              checked={billable}
              onCheckedChange={(checked) => setBillable(checked === true)}
            />
            <Label htmlFor={`${formId}-billable`} className="font-normal">
              Billable to the client
            </Label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={saving || !duration.trim() || !description.trim() || !day}>
            {saving ? 'Saving…' : entry ? 'Save entry' : 'Log time'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
