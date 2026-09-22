'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { VariableHelp } from '@/components/settings/variable-help';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type DocumentBlock, type DocumentType, PRICED_TYPES, TYPE_LABELS } from '@/convex/lib/documentBlocks';
import { errorMessage } from '@/lib/convex-error';
import { CREATABLE_TYPES } from '@/lib/documents-display';

// Editing a template's blocks (07-documents-and-esign.md, Templates and clauses). Saving a change makes a new version;
// documents already made from it keep theirs. The server refuses unknown variables and missing clauses, and a priced
// template without its totals, and those messages show here as they are.

type Template = NonNullable<typeof api.documentTemplates.get._returnType>;

const ADDABLE: { label: string; make: () => DocumentBlock }[] = [
  { label: 'Heading', make: () => ({ kind: 'heading', text: '', level: 2 }) },
  { label: 'Paragraph', make: () => ({ kind: 'paragraph', text: '' }) },
  { label: 'Clause', make: () => ({ kind: 'clause', clauseKey: '' }) },
  { label: 'Priced lines', make: () => ({ kind: 'lineItems' }) },
  { label: 'Totals', make: () => ({ kind: 'totals' }) },
  { label: 'Milestones', make: () => ({ kind: 'milestones' }) },
  { label: 'Payment schedule', make: () => ({ kind: 'paymentSchedule' }) },
  { label: 'Client signature', make: () => ({ kind: 'signature', party: 'client' }) },
  { label: 'Studio signature', make: () => ({ kind: 'signature', party: 'studio' }) },
  { label: 'Page break', make: () => ({ kind: 'pageBreak' }) },
];

/** The block's name in the editor. Signatures are told apart by whose they are, since they share a kind. */
function blockLabel(block: DocumentBlock): string {
  if (block.kind === 'signature') return block.party === 'client' ? 'Client signature' : 'Studio signature';
  return ADDABLE.find((option) => option.make().kind === block.kind)?.label ?? block.kind;
}

function describe(block: DocumentBlock): string {
  switch (block.kind) {
    case 'lineItems':
      return 'The priced lines, filled from the document';
    case 'totals':
      return 'The totals, with VAT and withholding tax';
    case 'milestones':
      return 'The project’s milestones';
    case 'paymentSchedule':
      return 'The payment schedule';
    case 'signature':
      return `A signature block for ${block.party === 'client' ? 'the client' : 'the studio'}`;
    case 'pageBreak':
      return 'A page break';
    case 'image':
      return block.alt;
    default:
      return '';
  }
}

export function TemplateEditor({ template, isOwner = false }: { template?: Template; isOwner?: boolean }) {
  const router = useRouter();
  const create = useMutation(api.documentTemplates.create);
  const update = useMutation(api.documentTemplates.update);
  const clauses = useQuery(api.clauses.list, {});
  const [type, setType] = useState<DocumentType>((template?.type as DocumentType) ?? 'quote');
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [blocks, setBlocks] = useState<DocumentBlock[]>(template?.blocks ?? []);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (index: number, block: DocumentBlock) => setBlocks(blocks.map((b, at) => (at === index ? block : b)));
  const move = (index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  };

  return (
    <form
      className="space-y-6"
      aria-label={template ? `Edit ${template.name}` : 'New template'}
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        setSaved(null);
        try {
          if (template) {
            const result = await update({
              templateId: template.id,
              name,
              description: description || undefined,
              blocks,
            });
            setSaved(result.version);
          } else {
            const templateId = await create({ type, name, description: description || undefined, blocks });
            router.push(`/settings/document-templates/${templateId}`);
          }
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setSaving(false);
        }
      }}
    >
      {template?.requiresLegalReview && <LegalReview template={template} isOwner={isOwner} />}

      <div className="grid gap-4 sm:grid-cols-2">
        {!template && (
          <div className="space-y-2">
            <Label htmlFor="template-type">Type</Label>
            <NativeSelect
              id="template-type"
              value={type}
              onChange={(event) => setType(event.target.value as DocumentType)}
            >
              {CREATABLE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="template-name">Name</Label>
          <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="template-description">Description (optional)</Label>
          <Input
            id="template-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      {PRICED_TYPES.has(type) && !blocks.some((block) => block.kind === 'totals') && (
        <p className="text-sm text-muted-foreground">
          A {TYPE_LABELS[type].toLowerCase()} carries a price, so it needs a totals block before it can be saved.
        </p>
      )}

      <div className="space-y-3">
        <h3 className="font-medium">Blocks</h3>
        {blocks.length === 0 && <p className="text-sm text-muted-foreground">No blocks yet. Add one below.</p>}
        <ol className="space-y-3" aria-label="Blocks">
          {blocks.map((block, index) => (
            <li key={index} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {blockLabel(block)}
                </span>
                <div className="flex gap-1 sm:ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move block ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move block ${index + 1} down`}
                    disabled={index === blocks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove block ${index + 1}`}
                    onClick={() => setBlocks(blocks.filter((_, at) => at !== index))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="mt-2">
                {block.kind === 'heading' ? (
                  <Input
                    aria-label={`Block ${index + 1} heading`}
                    value={block.text}
                    onChange={(event) => set(index, { ...block, text: event.target.value })}
                  />
                ) : block.kind === 'paragraph' ? (
                  <Textarea
                    aria-label={`Block ${index + 1} paragraph`}
                    rows={3}
                    value={block.text}
                    onChange={(event) => set(index, { ...block, text: event.target.value })}
                  />
                ) : block.kind === 'clause' ? (
                  <NativeSelect
                    aria-label={`Block ${index + 1} clause`}
                    value={block.clauseKey}
                    onChange={(event) => set(index, { kind: 'clause', clauseKey: event.target.value })}
                  >
                    <option value="">Choose a clause</option>
                    {clauses?.map((clause) => (
                      <option key={clause.id} value={clause.key}>
                        {clause.title} ({clause.key})
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <p className="text-sm text-muted-foreground">{describe(block)}</p>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="add-block" className="text-xs text-muted-foreground">
              Add a block
            </Label>
            <NativeSelect id="add-block" value={adding} onChange={(event) => setAdding(event.target.value)}>
              <option value="">Choose what to add</option>
              {ADDABLE.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!adding}
            onClick={() => {
              const option = ADDABLE.find((candidate) => candidate.label === adding);
              if (option) setBlocks([...blocks, option.make()]);
              setAdding('');
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <VariableHelp />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved !== null && <p className="text-sm text-muted-foreground">Saved as version {saved}.</p>}
      <Button type="submit" disabled={saving || !name.trim()}>
        {saving ? 'Saving…' : template ? 'Save the template' : 'Create the template'}
      </Button>
      {template && (
        <p className="text-sm text-muted-foreground">
          Documents already made from version {template.version} keep that wording.
        </p>
      )}
    </form>
  );
}

const approvedOn = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' });

/**
 * Where the lawyer's approval stands. It covers one version: once the wording changes, it needs approving again. Only
 * the Owner can record it.
 */
function LegalReview({ template, isOwner }: { template: Template; isOwner: boolean }) {
  const record = useMutation(api.documentTemplates.recordLegalApproval);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const approval = template.legalApproval;

  if (!template.needsLegalReview && approval) {
    return (
      <p className="rounded-md border p-3 text-sm">
        Your lawyer approved version {approval.version} on {approvedOn.format(approval.approvedAt)}
        {approval.note ? ` — ${approval.note}` : ''}. Changing the wording will need their approval again.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-md bg-attention p-4 text-sm text-attention-foreground">
      <p>
        This template is for a legal document. Have your lawyer read version {template.version} before it is sent to
        anyone.
        {approval ? ` They approved version ${approval.version}; the wording has changed since.` : ''}
      </p>
      {isOwner ? (
        <div className="space-y-2">
          <Label htmlFor="legal-approval-note">Who approved it (optional)</Label>
          <Input
            id="legal-approval-note"
            placeholder="Adaeze Okafor, Okafor & Co"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await record({ templateId: template.id, version: template.version, note: note || undefined });
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Recording…' : `Record the lawyer\u2019s approval of version ${template.version}`}
          </Button>
        </div>
      ) : (
        <p>Only the Owner can record the lawyer&rsquo;s approval.</p>
      )}
    </div>
  );
}
