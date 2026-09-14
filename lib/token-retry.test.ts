import { describe, expect, it, vi } from 'vitest';
import { isRetryable, withTokenRetries } from './token-retry';

const ok = { data: { token: 'jwt' }, error: null };
const noSession = { data: null, error: { status: 401 } };
const serverError = { data: null, error: { status: 503 } };
const offline = { data: null, error: {} };

describe('token renewal retries', () => {
  it('retries only failures that can pass', () => {
    expect(isRetryable(ok)).toBe(false);
    expect(isRetryable(noSession)).toBe(false);
    expect(isRetryable({ data: null, error: { status: 403 } })).toBe(false);
    expect(isRetryable(serverError)).toBe(true);
    expect(isRetryable({ data: null, error: { status: 429 } })).toBe(true);
    expect(isRetryable(offline)).toBe(true);
    // No token and no error: the session is gone, nothing to retry.
    expect(isRetryable({ data: null, error: null })).toBe(false);
  });

  it('gets the token after brief failures, waiting longer each time', async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce(offline)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const retrying = withTokenRetries(fetchToken, [10, 20, 40], sleep);

    expect(await retrying({ fetchOptions: { throw: false } })).toEqual(ok);
    expect(fetchToken).toHaveBeenCalledTimes(3);
    expect(fetchToken).toHaveBeenCalledWith({ fetchOptions: { throw: false } });
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('returns a real sign-out at once, and gives up after the last retry', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const signedOut = vi.fn().mockResolvedValue(noSession);
    expect(await withTokenRetries(signedOut, [10, 20], sleep)()).toEqual(noSession);
    expect(signedOut).toHaveBeenCalledOnce();

    const down = vi.fn().mockResolvedValue(serverError);
    expect(await withTokenRetries(down, [10, 20], sleep)()).toEqual(serverError);
    expect(down).toHaveBeenCalledTimes(3);
  });
});
