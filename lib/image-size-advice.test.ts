import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_WARN_BYTES, readableSize, sizeAdvice } from './image-size-advice';

// What the editor says about an image's weight (13-cms-and-website.md, Editing).

describe('advice on an image’s weight', () => {
  it('says nothing about one that is small enough', () => {
    expect(sizeAdvice(100 * 1024).level).toBe('ok');
    expect(sizeAdvice(IMAGE_WARN_BYTES).level).toBe('ok');
  });

  it('warns past the line, without refusing', () => {
    const advice = sizeAdvice(IMAGE_WARN_BYTES + 1);
    expect(advice.level).toBe('warn');
    expect(advice.message).toContain('slows the page down');
  });

  it('refuses one the website will not take, and says what to do about it', () => {
    const advice = sizeAdvice(IMAGE_MAX_BYTES + 1);
    expect(advice.level).toBe('refuse');
    // Not a dead end: shrinking is the way through, so the message says so.
    expect(advice.message).toContain('shrink it');
  });

  it('writes a size the way a person would read it', () => {
    expect(readableSize(700 * 1024)).toBe('700 KB');
    expect(readableSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
