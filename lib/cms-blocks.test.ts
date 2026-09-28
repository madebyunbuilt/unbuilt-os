import { describe, expect, it } from 'vitest';
import { blocksToText, textToBlocks } from './cms-blocks';

// Rich text as something writable in a textarea (lib/cms-blocks.ts). The property that matters is the round trip: what
// somebody did not touch has to come back unchanged, including blocks this editor has no way to show.

describe('writing a body as text', () => {
  it('turns headings and paragraphs into something readable', () => {
    expect(
      blocksToText([
        { kind: 'heading', text: 'What we do' },
        { kind: 'paragraph', text: 'We build things.' },
      ]),
    ).toBe('## What we do\n\nWe build things.');
  });

  it('reads them back', () => {
    expect(textToBlocks('## What we do\n\nWe build things.')).toEqual([
      { kind: 'heading', text: 'What we do' },
      { kind: 'paragraph', text: 'We build things.' },
    ]);
  });

  it('survives a round trip unchanged', () => {
    const blocks = [
      { kind: 'heading', text: 'One' },
      { kind: 'paragraph', text: 'First.' },
      { kind: 'paragraph', text: 'Second.' },
    ];
    expect(textToBlocks(blocksToText(blocks), blocks)).toEqual(blocks);
  });

  it('keeps a block it cannot show, rather than dropping it', () => {
    // An image block has no textarea representation. Losing it on a save would be losing somebody's work silently.
    const blocks = [
      { kind: 'paragraph', text: 'Before.' },
      { kind: 'image', fileId: 'f1', alt: 'A screenshot' },
      { kind: 'paragraph', text: 'After.' },
    ];
    const text = blocksToText(blocks);
    expect(text).toContain('[image]');
    expect(textToBlocks(text, blocks)).toEqual(blocks);
  });

  it('ignores blank lines somebody left behind', () => {
    expect(textToBlocks('One.\n\n\n\n\nTwo.\n\n')).toEqual([
      { kind: 'paragraph', text: 'One.' },
      { kind: 'paragraph', text: 'Two.' },
    ]);
  });

  it('starts from nothing without complaining', () => {
    expect(textToBlocks('')).toEqual([]);
    expect(blocksToText([])).toBe('');
  });
});
