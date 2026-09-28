// The website's rich text, as something writable in a textarea (13-cms-and-website.md, Editing).
//
// The website's renderer owns the full block vocabulary; this edits the two kinds that carry the writing — headings and
// paragraphs — and leaves anything else it does not understand untouched, so a block added by an import or by a future
// editor survives a round trip through this one rather than being silently dropped.

export type Block = { kind: string; text?: string; [key: string]: unknown };

const HEADING = /^##\s+/;

export function blocksToText(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'heading') return `## ${block.text ?? ''}`;
      if (block.kind === 'paragraph') return block.text ?? '';
      // Anything else is shown as a marker so it is visible rather than invisible, and is not editable here.
      return `[${block.kind}]`;
    })
    .join('\n\n');
}

export function textToBlocks(text: string, original: readonly Block[] = []): Block[] {
  const untouched = original.filter((block) => block.kind !== 'heading' && block.kind !== 'paragraph');
  const markers = new Set(untouched.map((block) => `[${block.kind}]`));

  const blocks: Block[] = [];
  for (const chunk of text.split(/\n{2,}/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    if (markers.has(trimmed)) {
      // Put back the block this marker stands for, in the place it was left.
      const kind = trimmed.slice(1, -1);
      const found = untouched.find((block) => block.kind === kind);
      if (found) blocks.push(found);
      continue;
    }
    blocks.push(
      HEADING.test(trimmed)
        ? { kind: 'heading', text: trimmed.replace(HEADING, '') }
        : { kind: 'paragraph', text: trimmed },
    );
  }
  return blocks;
}
