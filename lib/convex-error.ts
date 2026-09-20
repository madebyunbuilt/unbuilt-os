import { ConvexError } from 'convex/values';

/**
 * Something the person typed that the screen can reject before asking the server, such as "an hour and a bit" in a
 * duration. It carries its message the same way a Convex function does, so a form shows it instead of the fallback.
 */
export class InputError extends ConvexError<{ code: 'input.invalid'; message: string }> {
  constructor(message: string) {
    super({ code: 'input.invalid', message });
  }
}

/** The message a Convex function chose to show, or a generic one for anything unexpected. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | string;
    if (typeof data === 'string') return data;
    if (typeof data?.message === 'string') return data.message;
  }
  return fallback;
}
