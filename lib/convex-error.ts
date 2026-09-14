import { ConvexError } from 'convex/values';

/** The message a Convex function chose to show, or a generic one for anything unexpected. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | string;
    if (typeof data === 'string') return data;
    if (typeof data?.message === 'string') return data.message;
  }
  return fallback;
}
