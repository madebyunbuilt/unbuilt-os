'use client';

import { useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { emptyLine, type LineDraft, LineItemsEditor, toLineArgs } from '@/components/documents/line-items-editor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type DocumentType, PRICED_TYPES } from '@/convex/lib/documentBlocks';
import { type Currency } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { CREATABLE_TYPES, DOCUMENT_TYPE_LABELS } from '@/lib/documents-display';

// Starting a document (07-documents-and-esign.md). It begins as a draft from the type's default template, which can be
// swapped for another of the same type. Everything here can be changed before it is sent.

export function DocumentFormDialog({
  trigger,
  clientId,
  projectId,
  dealId,
  type: fixedType,
  canUseRateCard,
  onCreated,
}: {
  trigger: ReactNode;
  clientId?: Id<'clients'>;
  projectId?: Id<'projects'>;
  dealId?: Id<'deals'>;
  type?: DocumentType;
  canUseRateCard: boolean;
  onCreated?: (documentId: Id<'documents'>) => void;
}) {
  const create = useMutation(api.documents.create);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DocumentType>(fixedType ?? 'quote');
  const [client, setClient] = useState<string>(clientId ?? '');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState<Currency>('NGN');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const clients = useQuery(api.clients.list, open && !clientId ? {} : 'skip');
  const templates = useQuery(api.documentTemplates.list, open ? { type } : 'skip');
  const priced = PRICED_TYPES.has(type);
  const legal = templates?.find((template) => template.id === templateId)?.requiresLegalReview;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">New document</DialogTitle>
          <DialogDescription>
            It starts as a draft from the template for this type. Nothing reaches the client until you send it.
          </DialogDescription>
        </DialogHeader>
        <form
          id="document-form"
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!client) {
              setError('Choose the client this is for');
              return;
            }
            setSaving(true);
            setError(null);
            try {
              const documentId = await create({
                type,
                clientId: client as Id<'clients'>,
                projectId,
                dealId,
                title: title || undefined,
                templateId: (templateId || undefined) as Id<'documentTemplates'> | undefined,
                currency,
                validUntilDate: validUntil || undefined,
                lineItems: priced ? toLineArgs(lines, currency) : undefined,
              });
              setOpen(false);
              setTitle('');
              setLines([emptyLine()]);
              onCreated?.(documentId);
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {!fixedType && (
              <div className="space-y-2">
                <Label htmlFor="document-type">Type</Label>
                <NativeSelect
                  id="document-type"
                  value={type}
                  onChange={(event) => {
                    setType(event.target.value as DocumentType);
                    setTemplateId('');
                  }}
                >
                  {CREATABLE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {DOCUMENT_TYPE_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            {!clientId && (
              <div className="space-y-2">
                <Label htmlFor="document-client">Client</Label>
                <NativeSelect
                  id="document-client"
                  value={client}
                  disabled={!clients}
                  aria-invalid={error !== null && !client ? true : undefined}
                  onChange={(event) => setClient(event.target.value)}
                >
                  <option value="">{clients ? 'Choose a client' : 'Loading clients…'}</option>
                  {clients?.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="document-template">Template</Label>
              <NativeSelect
                id="document-template"
                value={templateId}
                disabled={!templates}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                <option value="">The default for this type</option>
                {templates?.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-currency">Currency</Label>
              <NativeSelect
                id="document-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as Currency)}
              >
                <option value="NGN">NGN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </NativeSelect>
            </div>
            {(type === 'quote' || type === 'proposal') && (
              <div className="space-y-2">
                <Label htmlFor="document-valid-until">Open until (optional)</Label>
                <Input
                  id="document-valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="document-title">Title (optional)</Label>
            <Input
              id="document-title"
              placeholder="Named after the client if you leave this"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          {priced && (
            <LineItemsEditor
              lines={lines}
              onChange={setLines}
              currency={currency}
              canUseRateCard={canUseRateCard}
              idPrefix="new-document"
            />
          )}

          {legal && (
            <p className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
              This template still needs your lawyer&rsquo;s approval. Read it before sending.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="document-form" disabled={saving}>
            {saving ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
