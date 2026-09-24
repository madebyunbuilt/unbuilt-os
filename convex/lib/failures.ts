import { ConvexError } from 'convex/values';

// What a person is told when a scheduled job fails (14-platform.md, Notifications). A ConvexError carries the sentence
// the function chose; an Error's `message` carries the whole "Uncaught ConvexError: {...} at ... at ..." trace once it
// has crossed from a mutation into the action that called it, and a stack trace in a notification tells nobody
// anything. Anything else is unexpected, and says so plainly rather than leaking internals.

/** The sentence inside "Uncaught ConvexError: {json}", when an error has crossed a Convex boundary as a string. */
function fromCrossedBoundary(message: string): string | null {
  const start = message.indexOf('{');
  if (start === -1) return null;
  const end = message.lastIndexOf('}');
  if (end <= start) return null;
  try {
    const data = JSON.parse(message.slice(start, end + 1)) as { message?: unknown };
    return typeof data.message === 'string' ? data.message : null;
  } catch {
    return null;
  }
}

/** The reason to put in front of a person when something scheduled did not work. */
export function failureReason(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | string;
    if (typeof data === 'string') return data;
    if (typeof data?.message === 'string') return data.message;
  }
  if (error instanceof Error) {
    const crossed = fromCrossedBoundary(error.message);
    if (crossed) return crossed;
    // A plain Error from our own code (a missing key, a failed render) is already written for a person.
    const firstLine = error.message.split('\n')[0].trim();
    if (firstLine && !firstLine.startsWith('Uncaught')) return firstLine;
  }
  return fallback;
}
