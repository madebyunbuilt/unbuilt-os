// Project status names and the moves allowed between them (06-projects.md, Projects). Kept free of server imports so
// screens can show the same moves the mutation will accept.

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled' | 'archived';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

/** Projects that are finished and can no longer change, except by reopening. */
export const CLOSED_PROJECT_STATUSES: ReadonlySet<ProjectStatus> = new Set(['completed', 'cancelled', 'archived']);

/** Which status changes are allowed. Archiving needs projects.archive; the rest need projects.update. */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  planning: ['active', 'on_hold', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: ['active', 'archived'],
  cancelled: ['planning', 'archived'],
  archived: ['completed'],
};
