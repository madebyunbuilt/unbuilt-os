import { describe, expect, it } from 'vitest';
import { htmlToText, linksIn, readableBody, unwrapRedirect } from './inboundEmail';

// What an email says, once it is words (09-support-and-sla.md, Tickets). A link that arrives as "click here" pointing
// at nothing is the difference between a ticket somebody can act on and one they have to go hunting for.

describe('reading an email body', () => {
  it('keeps the plain text the sender’s own software wrote', () => {
    expect(readableBody({ text: 'The site is down.', html: '<p>The site is down.</p>' })).toBe('The site is down.');
  });

  it('falls back to the HTML when there is no text at all', () => {
    expect(readableBody({ html: '<p>Hello</p><p>Goodbye</p>' })).toBe('Hello\nGoodbye');
  });

  it('uses the HTML when the text has lost a link the HTML still has', () => {
    // Zoho and Gmail both do this: the words survive, the address does not.
    const body = readableBody({
      text: 'Please review the page.\nAccept the invitation',
      html: '<p>Please review the page.</p><a href="https://example.com/accept?key=abc">Accept the invitation</a>',
    });
    expect(body).toContain('Accept the invitation (https://example.com/accept?key=abc)');
  });

  it('leaves the text alone when it already carries the address', () => {
    const text = 'See https://example.com/page for what is broken.';
    expect(readableBody({ text, html: '<a href="https://example.com/page">the page</a>' })).toBe(text);
  });

  it('does not print an address twice when the link is its own label', () => {
    expect(htmlToText('<a href="https://example.com/x">https://example.com/x</a>')).toBe('https://example.com/x');
  });

  it('drops a link that goes nowhere a person can follow', () => {
    expect(htmlToText('<a href="mailto:hi@example.com">email us</a>')).toBe('email us');
  });

  it('finds only the addresses worth keeping', () => {
    expect(linksIn('<a href="https://a.test">a</a><a href="mailto:b@test">b</a>')).toEqual(['https://a.test']);
  });

  it('shows where a Gmail link really goes, not Gmail’s redirector', () => {
    const wrapped = 'https://www.google.com/url?q=https://staging.example.com/checkout&source=gmail';
    expect(unwrapRedirect(wrapped)).toBe('https://staging.example.com/checkout');
    expect(htmlToText(`<a href="${wrapped}">the checkout step</a>`)).toBe(
      'the checkout step (https://staging.example.com/checkout)',
    );
  });

  it('keeps the sender’s own text when the wrapper hid a link it already carries', () => {
    // The text part has the real address; only the HTML was rewritten, so there is nothing missing after unwrapping.
    const text = 'Broken here: https://staging.example.com/checkout';
    const html = '<a href="https://www.google.com/url?q=https://staging.example.com/checkout">here</a>';
    expect(readableBody({ text, html })).toBe(text);
  });

  it('cleans a redirector out of the plain text too, which is where Gmail also puts it', () => {
    const text =
      'Broken page: the checkout step\n<https://www.google.com/url?q=https://staging.example.com/checkout&source=gmail>';
    const html = '<a href="https://www.google.com/url?q=https://staging.example.com/checkout">the checkout step</a>';
    expect(readableBody({ text, html })).toContain('<https://staging.example.com/checkout>');
    expect(readableBody({ text, html })).not.toContain('google.com/url');
  });

  it('leaves a link alone that only looks like a redirector', () => {
    expect(unwrapRedirect('https://example.com/url?q=nope')).toBe('https://example.com/url?q=nope');
  });

  it('returns nothing when there is nothing to read', () => {
    expect(readableBody({})).toBeNull();
  });
});
