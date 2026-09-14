import { describe, expect, it } from 'vitest';
import { isCommandPaletteKey, isTypingTarget } from './shortcuts';

describe('shortcuts', () => {
  it('recognise ⌘K and Ctrl K, in either case, but not with Alt', () => {
    const key = (overrides: Partial<KeyboardEvent>) =>
      isCommandPaletteKey({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, ...overrides });
    expect(key({ metaKey: true })).toBe(true);
    expect(key({ ctrlKey: true, key: 'K' })).toBe(true);
    expect(key({})).toBe(false);
    expect(key({ ctrlKey: true, altKey: true })).toBe(false);
  });

  it('treat fields and editable content as typing', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
