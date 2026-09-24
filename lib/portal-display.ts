import { type StatusTone } from '@/lib/team-display';

// How a client's own work is described to them (12-client-portal.md). The studio's internal words are not always the
// client's: "invoiced" is the studio's business, so an invoiced milestone simply reads as done.

export function projectStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'planning':
      return { label: 'Getting started', tone: 'draft' };
    case 'active':
      return { label: 'Under way', tone: 'built' };
    case 'on_hold':
      return { label: 'On hold', tone: 'attention' };
    case 'completed':
      return { label: 'Finished', tone: 'built' };
    default:
      return { label: 'Under way', tone: 'draft' };
  }
}

export function milestoneStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'upcoming':
      return { label: 'To come', tone: 'draft' };
    case 'in_progress':
      return { label: 'In progress', tone: 'draft' };
    case 'awaiting_approval':
      return { label: 'Waiting for you', tone: 'attention' };
    case 'approved':
    case 'invoiced':
      return { label: 'Done', tone: 'built' };
    case 'skipped':
      return { label: 'Not needed', tone: 'muted' };
    default:
      return { label: 'To come', tone: 'draft' };
  }
}
