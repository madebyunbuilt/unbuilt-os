import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSessionError, SessionBoundary } from './session-boundary';

const failure = vi.hoisted(() => ({ error: null as unknown }));

function Query() {
  if (failure.error) throw failure.error;
  return <p>Notifications</p>;
}

beforeEach(() => {
  // React logs caught render errors; the assertions cover them.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  failure.error = null;
  vi.restoreAllMocks();
});

describe('SessionBoundary', () => {
  it('recognises only session errors', () => {
    expect(isSessionError(new ConvexError({ code: 'auth.unauthenticated', message: 'Sign in to continue' }))).toBe(
      true,
    );
    expect(isSessionError(new ConvexError({ code: 'auth.sessionExpired', message: 'Expired' }))).toBe(true);
    expect(isSessionError(new ConvexError({ code: 'auth.forbidden', message: 'No' }))).toBe(false);
    expect(isSessionError(new ConvexError('plain'))).toBe(false);
    expect(isSessionError(new Error('auth.unauthenticated'))).toBe(false);
  });

  it('asks to sign in again when the session ends, and reloads for a fresh token on retry', async () => {
    failure.error = new ConvexError({ code: 'auth.unauthenticated', message: 'Sign in to continue' });
    const reload = vi.fn();
    render(
      <SessionBoundary reload={reload}>
        <Query />
      </SessionBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Your session has ended' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/sign-in');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('passes every other error on', () => {
    failure.error = new ConvexError({ code: 'auth.forbidden', message: 'You do not have access to this' });
    expect(() =>
      render(
        <SessionBoundary>
          <Query />
        </SessionBoundary>,
      ),
    ).toThrow();
  });
});
