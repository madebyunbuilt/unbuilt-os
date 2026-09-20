'use client';

import { useMutation, useQuery } from 'convex/react';
import { CalendarClock, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { TaskFormDialog } from '@/components/projects/task-form-dialog';
import { TaskPanel } from '@/components/projects/task-panel';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { CLOSED_PROJECT_STATUSES } from '@/convex/lib/projectStatus';
import { errorMessage } from '@/lib/convex-error';
import { formatDay } from '@/lib/crm-display';
import { formatHours } from '@/lib/projects-display';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
  taskPriority,
  taskStatus,
} from '@/lib/tasks-display';
import { cn } from '@/lib/utils';

// The project's tasks as a board or a list (06-projects.md, Tasks). Dragging needs a mouse, so every card also carries
// a "Move to" select.

type Task = (typeof api.tasks.listForProject._returnType)[number];

const today = () => new Date().toISOString().slice(0, 10);

export function TaskBoard({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [assignee, setAssignee] = useState('');
  const [milestone, setMilestone] = useState('');
  const [priority, setPriority] = useState('');
  const [dragging, setDragging] = useState<Id<'tasks'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const project = useQuery(api.projects.get, { projectId });
  const milestones = useQuery(api.milestones.listForProject, { projectId });
  const tasks = useQuery(api.tasks.listForProject, {
    projectId,
    assigneeMemberId: (assignee || undefined) as Id<'teamMembers'> | undefined,
    milestoneId: (milestone || undefined) as Id<'milestones'> | undefined,
    priority: (priority || undefined) as TaskPriority | undefined,
  });
  const move = useMutation(api.tasks.move);

  if (project === undefined || tasks === undefined) return <p className="text-muted-foreground">Loading tasks…</p>;

  const isOpen = !CLOSED_PROJECT_STATUSES.has(project.status);
  const canManage = permissions.includes('tasks.manage.all') || permissions.includes('tasks.manage.assigned');
  const options = (milestones?.milestones ?? []).map((row) => ({ id: row.id, name: row.name }));
  const members = project.members.map((member) => ({ memberId: member.memberId, name: member.name }));
  const openTask = params.get('task');
  const shown = openTask ? tasks.find((task) => task.id === openTask) : undefined;

  const onMove = async (task: Task, status: TaskStatus) => {
    setError(null);
    try {
      await move({ taskId: task.id, status });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const closePanel = () => router.replace(`/projects/${projectId}/tasks`, { scroll: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="View" className="flex gap-1">
          {(['board', 'list'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={view === option ? 'default' : 'outline'}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === 'board' ? 'Board' : 'List'}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-assignee" className="text-xs text-muted-foreground">
            Assignee
          </Label>
          <NativeSelect id="task-assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">Anyone</option>
            {members.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-milestone" className="text-xs text-muted-foreground">
            Milestone
          </Label>
          <NativeSelect id="task-milestone" value={milestone} onChange={(event) => setMilestone(event.target.value)}>
            <option value="">Any milestone</option>
            {options.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-priority" className="text-xs text-muted-foreground">
            Priority
          </Label>
          <NativeSelect id="task-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="">Any priority</option>
            {TASK_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {TASK_PRIORITY_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {canManage && isOpen && (
          <div className="sm:ml-auto">
            <TaskFormDialog
              projectId={projectId}
              milestones={options}
              members={members}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  New task
                </Button>
              }
            />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
          {error}
        </p>
      )}

      {tasks.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          No tasks match. A project created from a template starts with its tasks.
        </p>
      ) : view === 'board' ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <ol className="flex min-w-max gap-4" aria-label="Task columns">
            {TASK_STATUSES.map((status) => {
              const column = tasks.filter((task) => task.status === status).sort((a, b) => a.order - b.order);
              return (
                <li
                  key={status}
                  aria-label={TASK_STATUS_LABELS[status]}
                  className={cn(
                    'flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/50 p-3',
                    dragging && 'outline-1 outline-dashed outline-border',
                  )}
                  onDragOver={(event) => {
                    if (canManage && isOpen && dragging) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const task = tasks.find((row) => row.id === dragging);
                    setDragging(null);
                    if (task && task.status !== status) void onMove(task, status);
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <h2 className="font-medium">{TASK_STATUS_LABELS[status]}</h2>
                    <span className="text-sm text-muted-foreground">{column.length}</span>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {column.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        canMove={canManage && isOpen}
                        onOpen={() => router.replace(`/projects/${projectId}/tasks?task=${task.id}`, { scroll: false })}
                        onMove={(status) => void onMove(task, status)}
                        onDragStart={() => setDragging(task.id)}
                        onDragEnd={() => setDragging(null)}
                      />
                    ))}
                  </ul>
                  {canManage && isOpen && (
                    <TaskFormDialog
                      projectId={projectId}
                      status={status}
                      milestones={options}
                      members={members}
                      trigger={
                        <Button variant="ghost" size="sm" className="justify-start">
                          <Plus aria-hidden />
                          Add to {TASK_STATUS_LABELS[status].toLowerCase()}
                        </Button>
                      }
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <TaskTable
          tasks={tasks}
          canMove={canManage && isOpen}
          onOpen={(task) => router.replace(`/projects/${projectId}/tasks?task=${task.id}`, { scroll: false })}
          onMove={onMove}
        />
      )}

      {shown && (
        <TaskPanel
          task={shown}
          projectId={projectId}
          milestones={options}
          members={members}
          canManage={canManage}
          canMention={permissions.includes('team.view')}
          isOpen={isOpen}
          onClose={closePanel}
        />
      )}
    </div>
  );
}

function MoveSelect({ task, onMove }: { task: Task; onMove: (status: TaskStatus) => void }) {
  return (
    <>
      <Label htmlFor={`task-move-${task.id}`} className="sr-only">
        Move {task.title}
      </Label>
      <NativeSelect
        id={`task-move-${task.id}`}
        value={task.status}
        onChange={(event) => onMove(event.target.value as TaskStatus)}
      >
        {TASK_STATUSES.map((status) => (
          <option key={status} value={status}>
            {TASK_STATUS_LABELS[status]}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}

function TaskCard({
  task,
  canMove,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  canMove: boolean;
  onOpen: () => void;
  onMove: (status: TaskStatus) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const overdue = task.status !== 'done' && task.dueDate !== undefined && task.dueDate < today();
  return (
    <li
      draggable={canMove}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className="space-y-2 rounded-md border bg-background p-3 shadow-xs"
    >
      <button type="button" onClick={onOpen} className="block text-left">
        <span className="block font-medium">{task.title}</span>
        {task.milestone && <span className="block text-sm text-muted-foreground">{task.milestone.name}</span>}
      </button>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <ToneBadge {...taskPriority(task.priority)} />
        {task.assignees.length > 0 && <span>{task.assignees.map((person) => person.name).join(', ')}</span>}
        {task.dueDate && (
          <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-foreground')}>
            <CalendarClock aria-hidden className="size-3.5" />
            {overdue ? 'Was due ' : 'Due '}
            {formatDay(task.dueDate)}
          </span>
        )}
        {task.estimateMinutes !== undefined && <span>{formatHours(task.estimateMinutes)}</span>}
      </div>
      {canMove && <MoveSelect task={task} onMove={onMove} />}
    </li>
  );
}

function TaskTable({
  tasks,
  canMove,
  onOpen,
  onMove,
}: {
  tasks: Task[];
  canMove: boolean;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[48rem] text-sm">
        <caption className="sr-only">Tasks</caption>
        <thead className="bg-muted text-left">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Task
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Priority
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Assignees
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Due
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Estimate
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-t hover:bg-accent/50">
              <td className="px-4 py-3">
                <button type="button" onClick={() => onOpen(task)} className="block text-left">
                  <span className="block font-medium">{task.title}</span>
                  {task.milestone && <span className="block text-muted-foreground">{task.milestone.name}</span>}
                </button>
              </td>
              <td className="px-4 py-3">
                {canMove ? (
                  <MoveSelect task={task} onMove={(status) => void onMove(task, status)} />
                ) : (
                  <ToneBadge {...taskStatus(task.status)} />
                )}
              </td>
              <td className="px-4 py-3">
                <ToneBadge {...taskPriority(task.priority)} />
              </td>
              <td className="px-4 py-3">{task.assignees.map((person) => person.name).join(', ') || '—'}</td>
              <td className="px-4 py-3">{task.dueDate ? formatDay(task.dueDate) : '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {task.estimateMinutes === undefined ? '—' : formatHours(task.estimateMinutes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
