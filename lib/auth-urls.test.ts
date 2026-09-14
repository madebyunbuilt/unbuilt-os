import { describe, expect, it } from 'vitest';
import { safeCallbackURL, signInErrorMessage } from './auth-urls';

describe('safeCallbackURL', () => {
  it.each([
    ['/clients?page=2', '/clients?page=2'],
    ['/', '/'],
    [['/invoices', '/other'], '/invoices'],
  ])('keeps same-site path %j', (input, expected) => {
    expect(safeCallbackURL(input)).toBe(expected);
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', undefined, null])(
    'replaces %j with /',
    (input) => {
      expect(safeCallbackURL(input)).toBe('/');
    },
  );
});

describe('signInErrorMessage', () => {
  it('explains known errors and falls back for unknown ones', () => {
    expect(signInErrorMessage('INVALID_TOKEN')).toMatch(/already been used or has expired/);
    expect(signInErrorMessage('SESSION_IDLE')).toMatch(/12 hours/);
    expect(signInErrorMessage('SOMETHING_NEW')).toMatch(/Something went wrong/);
    expect(signInErrorMessage(undefined)).toBeNull();
  });
});
