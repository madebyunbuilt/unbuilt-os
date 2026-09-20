import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@/convex/lib/projectStatus';
import { type StatusTone } from '@/lib/team-display';

// How projects are shown: statuses in the brand's state colours, type and model labels, and hours. The status names
// and the moves between them live in convex/lib/projectStatus.ts, so screens and mutations agree.

export type { ProjectStatus };

const TONES: Record<ProjectStatus, StatusTone> = {
  // Planning is work not built yet; on hold needs attention.
  planning: 'draft',
  active: 'built',
  on_hold: 'attention',
  completed: 'built',
  cancelled: 'muted',
  archived: 'muted',
};

export function projectStatus(status: ProjectStatus): { label: string; tone: StatusTone } {
  return { label: PROJECT_STATUS_LABELS[status], tone: TONES[status] };
}

export const PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
  'archived',
];

export const PROJECT_TYPE_LABELS = {
  mobile_app: 'Mobile app',
  web_platform: 'Web platform',
  product_design: 'Product design',
  backend: 'Backend',
  devops: 'DevOps',
  video: 'Video and motion',
  dev_tool: 'Dev tool',
  retainer: 'Retainer',
  other: 'Other',
} as const;

export const BILLING_MODEL_LABELS = {
  fixed: 'Fixed price',
  time_and_materials: 'Time and materials',
  retainer: 'Retainer',
} as const;

export type MilestoneStatus = 'upcoming' | 'in_progress' | 'awaiting_approval' | 'approved' | 'invoiced' | 'skipped';

export function milestoneStatus(status: MilestoneStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'upcoming':
      return { label: 'Upcoming', tone: 'muted' };
    case 'in_progress':
      return { label: 'In progress', tone: 'draft' };
    case 'awaiting_approval':
      return { label: 'Waiting for the client', tone: 'attention' };
    case 'approved':
      return { label: 'Approved', tone: 'built' };
    case 'invoiced':
      return { label: 'Invoiced', tone: 'built' };
    case 'skipped':
      return { label: 'Skipped', tone: 'muted' };
  }
}

export type DeliverableStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved';

export function deliverableStatus(status: DeliverableStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'draft':
      return { label: 'Draft', tone: 'draft' };
    case 'in_review':
      return { label: 'With the client', tone: 'draft' };
    case 'changes_requested':
      return { label: 'Changes requested', tone: 'attention' };
    case 'approved':
      return { label: 'Approved', tone: 'built' };
  }
}

/** Minutes as hours for display: 90 → "1.5h", 120 → "2h", 0 → "0h". */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(2))}h`;
}

/** Hours typed by a person as whole minutes: "1.5" → 90, "" → undefined. Refuses anything that is not a number. */
export function parseHoursToMinutes(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const hours = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Give the hours as a number, such as 1.5');
  return Math.round(hours * 60);
}

/** Minutes as hours for an input: 90 → "1.5", undefined → "". */
export function toHoursInput(minutes: number | undefined): string {
  if (minutes === undefined) return '';
  const hours = minutes / 60;
  return String(Number.isInteger(hours) ? hours : Number(hours.toFixed(2)));
}

/** Bytes as a short size: 2,400,000 → "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${Number((kb / 1024).toFixed(1))} MB`;
}
