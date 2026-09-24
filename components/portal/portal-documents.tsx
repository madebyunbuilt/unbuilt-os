'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { FormDialog } from '@/components/app/form-dialog';
import { DocumentBlocks } from '@/components/documents/document-blocks';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import { portalDocumentStatus } from '@/lib/portal-display';

// Documents as the client sees them (12-client-portal.md, Documents): what was sent, what it says, and the one thing
// they are being asked to do about it.

export function PortalDocuments() {
  const documents = useQuery(api.portalDocuments.list, {});
  if (documents === undefined) return <p className="text-muted-foreground">Loading documents…</p>;
  if (documents.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-muted-foreground">
        Nothing here yet. Quotes, proposals and agreements appear here once Unbuilt sends them.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {documents.map((document) => (
        <li key={document.id} className="rounded-lg border p-4">
          <Link href={`/documents/${document.id}`} className="block">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{document.title}</p>
                <p className="text-sm text-muted-foreground">
                  {document.typeLabel}
                  {document.number ? ` · ${document.number}` : ''}
                  {document.sentAt ? ` · sent ${formatDay(new Date(document.sentAt).toISOString().slice(0, 10))}` : ''}
                </p>
              </div>
              <div className="text-right">
                {document.totals && document.currency && (
                  <p className="font-medium tabular-nums">
                    {formatMoney(document.totals.totalMinor, document.currency as Currency)}
                  </p>
                )}
                <ToneBadge {...portalDocumentStatus(document.status, document.asks)} />
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DeclineDialog({ documentId, typeLabel }: { documentId: Id<'documents'>; typeLabel: string }) {
  const decide = useMutation(api.portalDocuments.decide);
  const [note, setNote] = useState('');
  return (
    <FormDialog
      trigger={<Button variant="outline">Decline</Button>}
      title={`Decline this ${typeLabel.toLowerCase()}`}
      description="Unbuilt will see your reason. Nothing is charged and nothing starts."
      submitLabel="Decline"
      canSubmit={note.trim().length > 0}
      onSubmit={() => decide({ documentId, decision: 'declined', note })}
    >
      <div className="space-y-2">
        <Label htmlFor="decline-note">Why</Label>
        <Textarea id="decline-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
    </FormDialog>
  );
}

function AcceptDialog({
  documentId,
  typeLabel,
  amount,
}: {
  documentId: Id<'documents'>;
  typeLabel: string;
  amount?: string;
}) {
  const decide = useMutation(api.portalDocuments.decide);
  return (
    <FormDialog
      trigger={<Button>Accept</Button>}
      title={`Accept this ${typeLabel.toLowerCase()}`}
      description={
        amount
          ? `This agrees ${amount} on the terms written here, and Unbuilt will start the work.`
          : 'This agrees the terms written here, and Unbuilt will start the work.'
      }
      submitLabel="Accept"
      onSubmit={() => decide({ documentId, decision: 'accepted' })}
    >
      <p className="text-sm text-muted-foreground">
        Your name and the time are recorded against it, and Unbuilt is told straight away.
      </p>
    </FormDialog>
  );
}

export function PortalDocument({ documentId }: { documentId: Id<'documents'> }) {
  const document = useQuery(api.portalDocuments.get, { documentId });
  const pdf = useQuery(api.files.portalDownloadUrl, document?.pdfFileId ? { fileId: document.pdfFileId } : 'skip');

  if (document === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (document === null) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">This document is not available.</p>;
  }

  const currency = (document.currency ?? 'NGN') as Currency;
  const amount = document.totals ? formatMoney(document.totals.totalMinor, currency) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/documents" className="text-sm underline">
          ← Documents
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">{document.title}</h1>
            <p className="mt-1 text-muted-foreground">
              {document.typeLabel}
              {document.number ? ` · ${document.number}` : ''}
              {document.validUntilDate ? ` · valid until ${formatDay(document.validUntilDate)}` : ''}
            </p>
          </div>
          <ToneBadge {...portalDocumentStatus(document.status, document.asks)} />
        </div>
      </div>

      {document.declinedReason && (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          You declined this: {document.declinedReason}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {document.canDecide && document.asks === 'decision' && (
          <>
            <AcceptDialog documentId={document.id} typeLabel={document.typeLabel} amount={amount} />
            <DeclineDialog documentId={document.id} typeLabel={document.typeLabel} />
          </>
        )}
        {pdf && (
          <Button variant="outline" asChild>
            <a href={pdf.url} target="_blank" rel="noreferrer">
              Download the PDF
            </a>
          </Button>
        )}
      </div>

      {document.asks === 'signature' && document.status !== 'signed' && (
        <p className="rounded-md border p-4 text-sm">
          This one is signed rather than accepted. When Unbuilt asks for your signature you will get an email with your
          own signing link.
        </p>
      )}

      <DocumentBlocks
        blocks={document.blocks}
        lineItems={document.lineItems.length > 0 ? document.lineItems : undefined}
        totals={document.totals}
        currency={currency}
      />
    </div>
  );
}
