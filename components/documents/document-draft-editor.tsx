'use client';

import { useMutation } from 'convex/react';
import { useState } from 'react';
import {
  emptyLine,
  type LineDraft,
  LineItemsEditor,
  toLineArgs,
  toLineDrafts,
} from '@/components/documents/line-items-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type DocumentBlock, PRICED_TYPES } from '@/convex/lib/documentBlocks';
import { errorMessage } from '@/lib/convex-error';

// Editing a draft. The wording came from the template and can be changed here; headings and paragraphs are the parts
// worth typing into, and the rest of the blocks keep their place.

type Document = NonNullable<typeof api.documents.get._returnType>;

export function DocumentDraftEditor({
  document,
  canUseRateCard,
  onDone,
}: {
  document: Document;
  canUseRateCard: boolean;
  onDone: () => void;
}) {
  const update = useMutation(api.documents.update);
  const refreshText = useMutation(api.documents.refreshText);
  const [title, setTitle] = useState(document.title);
  const [validUntil, setValidUntil] = useState(document.validUntilDate ?? '');
  const [blocks, setBlocks] = useState<DocumentBlock[]>(document.blocks);
  const [lines, setLines] = useState<LineDraft[]>(
    toLineDrafts(document.lineItems).length > 0 ? toLineDrafts(document.lineItems) : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const priced = PRICED_TYPES.has(document.type);
  const currency = document.currency ?? 'NGN';

  const setBlockText = (index: number, text: string) =>
    setBlocks(blocks.map((block, at) => (at === index ? { ...block, text } : block)));

  return (
    <form
      className="space-y-6 rounded-lg border p-6"
      aria-label="Edit the draft"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await update({
            documentId: document.id,
            title,
            blocks,
            lineItems: priced ? toLineArgs(lines, currency) : undefined,
            validUntilDate: validUntil || undefined,
          });
          onDone();
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="draft-title">Title</Label>
          <Input id="draft-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        {(document.type === 'quote' || document.type === 'proposal') && (
          <div className="space-y-2">
            <Label htmlFor="draft-valid-until">Open until</Label>
            <Input
              id="draft-valid-until"
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </div>
        )}
      </div>

      {priced && (
        <LineItemsEditor
          lines={lines}
          onChange={setLines}
          currency={currency}
          canUseRateCard={canUseRateCard}
          idPrefix={`draft-${document.id}`}
        />
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>The wording</Label>
          {/* Only a document made from a template has one to rebuild from. */}
          {document.templateId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                setError(null);
                try {
                  await refreshText({ documentId: document.id });
                  onDone();
                } catch (caught) {
                  setError(errorMessage(caught));
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              {refreshing ? 'Rebuilding…' : 'Rebuild from the template'}
            </Button>
          )}
        </div>
        {document.templateId && (
          <p className="text-sm text-muted-foreground">
            Rebuilding replaces everything below with the template again, with today&rsquo;s client and project details.
          </p>
        )}
        <ul className="space-y-3">
          {blocks.map((block, index) =>
            block.kind === 'heading' || block.kind === 'paragraph' ? (
              <li key={index} className="space-y-1">
                <Label htmlFor={`block-${index}`} className="text-xs text-muted-foreground">
                  {block.kind === 'heading' ? 'Heading' : 'Paragraph'}
                </Label>
                {block.kind === 'heading' ? (
                  <Input
                    id={`block-${index}`}
                    value={block.text}
                    onChange={(event) => setBlockText(index, event.target.value)}
                  />
                ) : (
                  <Textarea
                    id={`block-${index}`}
                    rows={3}
                    value={block.text}
                    onChange={(event) => setBlockText(index, event.target.value)}
                  />
                )}
              </li>
            ) : (
              <li key={index} className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                {block.kind === 'lineItems'
                  ? 'The priced lines, from above'
                  : block.kind === 'totals'
                    ? 'The totals'
                    : block.kind === 'milestones'
                      ? 'The project’s milestones'
                      : block.kind === 'paymentSchedule'
                        ? 'The payment schedule'
                        : block.kind === 'signature'
                          ? `A signature block for ${block.party === 'client' ? 'the client' : 'the studio'}`
                          : block.kind === 'pageBreak'
                            ? 'A page break'
                            : block.kind === 'image'
                              ? block.alt
                              : // A clause was copied into the wording when the document was created, so none is left here.
                                'A clause'}
              </li>
            ),
          )}
        </ul>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save the draft'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
