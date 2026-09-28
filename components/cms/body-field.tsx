'use client';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type Block, blocksToText, textToBlocks } from '@/lib/cms-blocks';

// The body of a service page or an insight. A blank line starts a new paragraph, and a line beginning with ## is a
// heading — which is as much structure as this needs until the website asks for more.

export function BodyField({
  id,
  label,
  value,
  onChange,
  rows = 14,
}: {
  id: string;
  label: string;
  value: Block[];
  onChange: (next: Block[]) => void;
  rows?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={rows}
        className="font-mono text-sm"
        value={blocksToText(value)}
        onChange={(event) => onChange(textToBlocks(event.target.value, value))}
      />
      <p className="text-sm text-muted-foreground">
        A blank line starts a new paragraph. Begin a line with ## for a heading.
      </p>
    </div>
  );
}
