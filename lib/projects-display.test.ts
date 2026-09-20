import { describe, expect, it } from 'vitest';
import { deliverableStatus, formatBytes, formatHours, milestoneStatus, projectStatus } from './projects-display';

describe('projects display', () => {
  it('shows planning as not built yet and on hold as needing attention', () => {
    expect(projectStatus('planning')).toEqual({ label: 'Planning', tone: 'draft' });
    expect(projectStatus('active').tone).toBe('built');
    expect(projectStatus('on_hold').tone).toBe('attention');
    expect(projectStatus('archived').tone).toBe('muted');
  });

  it('labels milestone and deliverable states in plain words', () => {
    expect(milestoneStatus('awaiting_approval')).toEqual({ label: 'Waiting for the client', tone: 'attention' });
    expect(milestoneStatus('approved').tone).toBe('built');
    expect(deliverableStatus('in_review').label).toBe('With the client');
    expect(deliverableStatus('changes_requested').tone).toBe('attention');
  });

  it('formats hours and file sizes', () => {
    expect(formatHours(90)).toBe('1.5h');
    expect(formatHours(120)).toBe('2h');
    expect(formatHours(0)).toBe('0h');
    expect(formatHours(95)).toBe('1.58h');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(2_400_000)).toBe('2.3 MB');
  });
});
