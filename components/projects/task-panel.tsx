'use client';

import { useMutation } from 'convex/react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { CommentsThread } from '@/components/projects/comments-thread';
import { TaskFormDialog } from '@/components/projects/task-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatDay } from '@/lib/crm-display';
import { formatHours } from '@/lib/projects-display';
import { taskPriority, taskStatus } from '@/lib/tasks-display';

// One task, opened from the board as ?task=<id> so a mention notification can link straight to it.

type Task = (typeof api.tasks.listForProject._returnType)[number];

export function TaskPanel({
  task,
  projectId,
  milestones,
  members,
  canManage,
  canMention,
  isOpen,
  onClose,
}: {
  task: Task;
  projectId: Id<'projects'>;
  milestones: { id: Id<'milestones'>; name: string }[];
  members: { memberId: Id<'teamMembers'>; name: string }[];
  canManage: boolean;
  canMention: boolean;
  /** Closed projects are read-only. */
  isOpen: boolean;
  onClose: () => void;
}) {
  const remove = useMutation(api.tasks.remove);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">{task.title}</DialogTitle>
          <DialogDescription>
            {[task.milestone?.name ?? 'No milestone', taskStatus(task.status).label].join(' · ')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge {...taskStatus(task.status)} />
            <ToneBadge {...taskPriority(task.priority)} />
            {task.dueDate && <span className="text-sm text-muted-foreground">Due {formatDay(task.dueDate)}</span>}
            {task.estimateMinutes !== undefined && (
              <span className="text-sm text-muted-foreground">Estimate {formatHours(task.estimateMinutes)}</span>
            )}
          </div>

          <p className="text-sm">
            <span className="text-muted-foreground">Assigned to </span>
            {task.assignees.length === 0 ? 'nobody yet' : task.assignees.map((person) => person.name).join(', ')}
          </p>

          {task.description && <p className="whitespace-pre-wrap">{task.description}</p>}

          {canManage && isOpen && (
            <div className="flex flex-wrap gap-2">
              <TaskFormDialog
                projectId={projectId}
                task={task}
                milestones={milestones}
                members={members}
                trigger={<Button variant="outline">Edit</Button>}
              />
              <ConfirmDialog
                trigger={<Button variant="ghost">Delete</Button>}
                title={`Delete ${task.title}?`}
                description="Its comments go with it. Time logged against it stays on the project."
                confirmLabel="Delete"
                onConfirm={async () => {
                  await remove({ taskId: task.id });
                  onClose();
                }}
              />
            </div>
          )}

          <CommentsThread target={{ table: 'tasks', id: task.id }} canMention={canMention} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
