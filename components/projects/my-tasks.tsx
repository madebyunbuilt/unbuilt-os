'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { ToneBadge } from '@/components/team/status-badge';
import { api } from '@/convex/_generated/api';
import { formatDay } from '@/lib/crm-display';
import { taskPriority, taskStatus } from '@/lib/tasks-display';
import { cn } from '@/lib/utils';

// Your open tasks across projects, overdue first (06-projects.md, Tasks). The full dashboard arrives with reports.

const LIMIT = 8;
const today = () => new Date().toISOString().slice(0, 10);

export function MyTasks() {
  const tasks = useQuery(api.tasks.mine, {});
  if (tasks === undefined) return <p className="text-muted-foreground">Loading your tasks…</p>;

  return (
    <section aria-labelledby="my-tasks-heading" className="space-y-3">
      <h2 id="my-tasks-heading" className="font-display text-xl font-bold">
        My tasks
      </h2>
      {tasks.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">Nothing assigned to you is open.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.slice(0, LIMIT).map((task) => {
            const overdue = task.dueDate !== undefined && task.dueDate < today();
            return (
              <li key={task.id}>
                <Link
                  href={`/projects/${task.projectId}/tasks?task=${task.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 hover:bg-muted/50"
                >
                  <span className="font-medium">{task.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {task.projectCode} {task.projectName}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
                    {task.dueDate && (
                      <span className={cn('text-sm text-muted-foreground', overdue && 'font-medium text-foreground')}>
                        {overdue ? 'Was due ' : 'Due '}
                        {formatDay(task.dueDate)}
                      </span>
                    )}
                    <ToneBadge {...taskPriority(task.priority)} />
                    <ToneBadge {...taskStatus(task.status)} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {tasks.length > LIMIT && (
        <p className="text-sm text-muted-foreground">{tasks.length - LIMIT} more open, on their project boards.</p>
      )}
    </section>
  );
}
