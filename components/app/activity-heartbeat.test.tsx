import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeartbeat, HEARTBEAT_INTERVAL_MS } from './activity-heartbeat';

const record = vi.hoisted(() => vi.fn());

vi.mock('convex/react', () => ({ useMutation: () => record }));
vi.mock('@/convex/_generated/api', () => ({ api: { sessionActivity: { record: 'sessionActivity:record' } } }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-14T09:00:00Z'));
  record.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActivityHeartbeat', () => {
  it('reports opening the page, then real use at most every few minutes', () => {
    const { unmount } = render(<ActivityHeartbeat />);
    expect(record).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.pointerDown(window);
    expect(record).toHaveBeenCalledOnce();

    vi.setSystemTime(Date.now() + HEARTBEAT_INTERVAL_MS);
    fireEvent.wheel(window);
    expect(record).toHaveBeenCalledTimes(2);

    unmount();
    vi.setSystemTime(Date.now() + HEARTBEAT_INTERVAL_MS);
    fireEvent.keyDown(window, { key: 'a' });
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('ignores a refused heartbeat; the page’s queries show the session-ended screen', async () => {
    record.mockRejectedValue(new Error('auth.sessionExpired'));
    render(<ActivityHeartbeat />);
    await Promise.resolve();
    expect(record).toHaveBeenCalledOnce();
  });
});
