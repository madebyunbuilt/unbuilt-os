import { describe, expect, it } from 'vitest';
import { renderAuthEmail } from './authEmails';

// Rendered in the same edge runtime the Convex tests use, so a template that cannot render in Convex fails here.
describe('sign-in emails', () => {
  it('render the magic link in HTML and plain text', async () => {
    const url = 'https://os.unbuilt.studio/api/auth/magic-link/verify?token=abc&callbackURL=%2F';
    const email = await renderAuthEmail({ kind: 'magicLink', to: 'dayo@unbuilt.studio', url });
    expect(email.subject).toBe('Your Unbuilt OS sign-in link');
    expect(email.html).toContain(
      'href="https://os.unbuilt.studio/api/auth/magic-link/verify?token=abc&amp;callbackURL=%2F"',
    );
    expect(email.text).toContain(url);
    expect(email.text).toContain('expires in 15 minutes');
  });

  it('render the code in the subject, HTML and plain text', async () => {
    const email = await renderAuthEmail({ kind: 'signInCode', to: 'ada@glossup.com', code: '482913' });
    expect(email.subject).toBe('482913 is your Unbuilt OS sign-in code');
    expect(email.html).toContain('482913');
    expect(email.text).toContain('482913');
  });
});
