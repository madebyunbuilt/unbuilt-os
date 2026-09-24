import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { failureReason } from './failures';

// What a failed job puts in front of a person (14-platform.md, Notifications). The trap is that a ConvexError thrown
// in a mutation reaches the action that called it as an ordinary Error whose message is the whole trace.

describe('the reason a job failed', () => {
  it('takes the sentence a function chose', () => {
    const error = new ConvexError({ code: 'documents.missingDetails', message: 'Fill these in before sending: …' });
    expect(failureReason(error, 'fallback')).toBe('Fill these in before sending: …');
  });

  it('takes a ConvexError whose data is just a string', () => {
    expect(failureReason(new ConvexError('Nothing to send'), 'fallback')).toBe('Nothing to send');
  });

  it('digs the sentence out of a trace that crossed a Convex boundary', () => {
    // Exactly what an action catches when the mutation it called threw.
    const crossed = new Error(
      'Uncaught ConvexError: {"code":"documents.missingDetails","message":"Fill these in before sending: the payment schedule in words"}\n' +
        '    at documentError (../../convex/lib/documentBlocks.ts:7:0)\n' +
        '    at handler (../../convex/documents.ts:847:4)',
    );
    expect(failureReason(crossed, 'fallback')).toBe('Fill these in before sending: the payment schedule in words');
  });

  it('keeps a plain error’s own words, which are already written for a person', () => {
    expect(failureReason(new Error('RESEND_API_KEY is not set on this deployment'), 'fallback')).toBe(
      'RESEND_API_KEY is not set on this deployment',
    );
  });

  it('says something plain for anything else, rather than leaking internals', () => {
    expect(failureReason({ weird: true }, 'The invoice could not be sent')).toBe('The invoice could not be sent');
    expect(failureReason(new Error(''), 'The invoice could not be sent')).toBe('The invoice could not be sent');
    // A trace with no readable sentence in it is not worth showing either.
    expect(failureReason(new Error('Uncaught TypeError: x is not a function\n    at foo'), 'Nope')).toBe('Nope');
  });
});
