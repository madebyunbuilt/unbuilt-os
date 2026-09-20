import { type StatusTone } from '@/lib/team-display';

// How tasks are shown: the board's columns in order, and priorities (06-projects.md, Tasks).

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done'];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

export function taskStatus(status: TaskStatus): { label: string; tone: StatusTone } {
  // Blocked is the one that needs someone to act.
  const tones: Record<TaskStatus, StatusTone> = {
    todo: 'muted',
    in_progress: 'draft',
    blocked: 'attention',
    done: 'built',
  };
  return { label: TASK_STATUS_LABELS[status], tone: tones[status] };
}

export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/** Low and medium are quiet; high and urgent stand out. */
export function taskPriority(priority: TaskPriority): { label: string; tone: StatusTone } {
  const tones: Record<TaskPriority, StatusTone> = {
    low: 'muted',
    medium: 'muted',
    high: 'draft',
    urgent: 'attention',
  };
  return { label: TASK_PRIORITY_LABELS[priority], tone: tones[priority] };
}
