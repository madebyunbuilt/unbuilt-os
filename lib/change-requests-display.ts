import { type StatusTone } from '@/lib/team-display';

// How change requests are shown (06-projects.md, Change requests), in the words the studio would use.

export type ChangeRequestStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'withdrawn';

export function changeRequestStatus(status: ChangeRequestStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'draft':
      return { label: 'Draft', tone: 'draft' };
    case 'sent':
      return { label: 'With the client', tone: 'attention' };
    case 'approved':
      return { label: 'Approved', tone: 'built' };
    case 'declined':
      return { label: 'Declined', tone: 'muted' };
    case 'withdrawn':
      return { label: 'Withdrawn', tone: 'muted' };
  }
}

export const TRIGGER_LABELS: Record<string, string> = {
  on_signature: 'When the contract is signed',
  on_date: 'On a date',
  on_milestone_approved: 'When a milestone is approved',
};

export const ITEM_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting',
  invoiced: 'Invoiced',
  skipped: 'Skipped',
};
