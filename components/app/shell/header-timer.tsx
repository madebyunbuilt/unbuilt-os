'use client';

import { useMutation, useQuery } from 'convex/react';
import { Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { formatDuration } from '@/lib/time-display';

// The timer in the app header (06-projects.md, Time tracking). Stopping it writes a draft entry rounded up to the
// minute; a timer left running is capped at 12 hours by the server.

const nowMs = () => Date.now();

/** Counts up from a start time, to the minute: the entry is rounded up to minutes anyway. */
function useElapsedMinutes(startedAt: number | undefined) {
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    if (startedAt === undefined) return;
    const tick = setInterval(() => setNow(nowMs()), 30_000);
    return () => clearInterval(tick);
  }, [startedAt]);
  return startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / 60_000));
}

export function HeaderTimer() {
  const timer = useQuery(api.time.runningTimer, {});
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const elapsed = useElapsedMinutes(timer?.startedAt);

  if (timer === undefined) return null;

  return (
    <>
      {timer === null ? (
        <Button variant="ghost" size="sm" aria-label="Start a timer" onClick={() => setStarting(true)}>
          <Play aria-hidden />
          <span className="hidden sm:inline">Start a timer</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Stop the timer on ${timer.projectName}`}
          onClick={() => setStopping(true)}
        >
          <Square aria-hidden />
          <span className="tabular-nums">{formatDuration(elapsed)}</span>
          <span className="hidden max-w-32 truncate sm:inline">{timer.projectName}</span>
        </Button>
      )}
      {starting && <StartDialog onClose={() => setStarting(false)} />}
      {stopping && timer && <StopDialog timer={timer} elapsed={elapsed} onClose={() => setStopping(false)} />}
    </>
  );
}

function StartDialog({ onClose }: { onClose: () => void }) {
  const start = useMutation(api.time.startTimer);
  const projects = useQuery(api.time.myRecentProjects, {});
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tasks = useQuery(api.tasks.listForProject, projectId ? { projectId: projectId as Id<'projects'> } : 'skip');

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Start a timer</DialogTitle>
          <DialogDescription>Stopping it writes a draft entry you can tidy up afterwards.</DialogDescription>
        </DialogHeader>
        <form
          id="start-timer"
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!projectId) {
              setError('Choose the project you are working on');
              return;
            }
            setSaving(true);
            setError(null);
            try {
              await start({
                projectId: projectId as Id<'projects'>,
                taskId: (taskId || undefined) as Id<'tasks'> | undefined,
                description: description || undefined,
              });
              onClose();
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="timer-project">Project</Label>
            <NativeSelect
              id="timer-project"
              value={projectId}
              disabled={!projects}
              aria-invalid={error !== null && !projectId ? true : undefined}
              onChange={(event) => {
                setProjectId(event.target.value);
                setTaskId('');
              }}
            >
              <option value="">{projects ? 'Choose a project' : 'Loading projects…'}</option>
              {projects?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timer-task">Task (optional)</Label>
            <NativeSelect
              id="timer-task"
              value={taskId}
              disabled={!projectId}
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
          <div className="space-y-2">
            <Label htmlFor="timer-description">What you are doing (optional)</Label>
            <Input
              id="timer-description"
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
          <Button type="submit" form="start-timer" disabled={saving}>
            {saving ? 'Starting…' : 'Start'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StopDialog({
  timer,
  elapsed,
  onClose,
}: {
  timer: NonNullable<typeof api.time.runningTimer._returnType>;
  elapsed: number;
  onClose: () => void;
}) {
  const stop = useMutation(api.time.stopTimer);
  const cancel = useMutation(api.time.cancelTimer);
  const [description, setDescription] = useState(timer.description);
  const [billable, setBillable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Stop the timer</DialogTitle>
          <DialogDescription>
            {formatDuration(elapsed)} on {timer.projectName}
            {timer.taskTitle ? ` · ${timer.taskTitle}` : ''}. It becomes a draft entry on today.
          </DialogDescription>
        </DialogHeader>
        <form
          id="stop-timer"
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            try {
              await stop({ description: description || undefined, billable });
              onClose();
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="stop-description">What you did</Label>
            <Input id="stop-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="stop-billable"
              checked={billable}
              onCheckedChange={(checked) => setBillable(checked === true)}
            />
            <Label htmlFor="stop-billable" className="font-normal">
              Billable to the client
            </Label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await cancel({});
                onClose();
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setSaving(false);
              }
            }}
          >
            Throw it away
          </Button>
          <Button type="submit" form="stop-timer" disabled={saving}>
            {saving ? 'Stopping…' : 'Stop and keep'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
