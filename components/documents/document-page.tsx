'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DocumentBlocks } from '@/components/documents/document-blocks';
import { DecisionDialog, DownloadPdfButton, SendDialog, VoidDialog } from '@/components/documents/document-actions';
import { DocumentDraftEditor } from '@/components/documents/document-draft-editor';
import { DocumentFormDialog } from '@/components/documents/document-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type DocumentType } from '@/convex/lib/documentBlocks';
import { formatDay } from '@/lib/crm-display';
import { DOCUMENT_TYPE_LABELS, type DocumentStatus, documentStatus, NEXT_IN_CHAIN } from '@/lib/documents-display';

// One document: what it says, where it is in its chain, and the few things that can be done to it from here.

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function DocumentPage({ documentId, permissions }: { documentId: Id<'documents'>; permissions: string[] }) {
  const router = useRouter();
  const document = useQuery(api.documents.get, { documentId });
  const logView = useMutation(api.documents.logTeamView);
  const [editing, setEditing] = useState(false);

  // Recorded as a team view, which never counts as the client opening it.
  useEffect(() => {
    if (document) void logView({ documentId });
  }, [documentId, document !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  if (document === undefined) return <p className="text-muted-foreground">Loading the document…</p>;

  const status = document.status as DocumentStatus;
  const isDraft = status === 'draft';
  const withClient = status === 'sent' || status === 'viewed';
  const next = NEXT_IN_CHAIN[document.type as DocumentType] ?? [];

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Link
          href="/documents"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Documents
        </Link>

        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold">{document.title}</h1>
              <ToneBadge {...documentStatus(status)} />
            </div>
            <p className="mt-1 text-muted-foreground">
              {document.typeLabel}
              {document.number ? ` · ${document.number}` : ' · not numbered until it is sent'} ·{' '}
              {permissions.includes('clients.view') ? (
                <Link href={`/crm/clients/${document.clientId}`} className="underline underline-offset-4">
                  {document.clientName}
                </Link>
              ) : (
                document.clientName
              )}
              {document.projectName && ` · ${document.projectName}`}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Drafted by {document.createdByName}
              {document.sentAt !== undefined && ` · sent ${dateTime.format(document.sentAt)}`}
              {document.firstViewedAt !== undefined && ` · first opened ${dateTime.format(document.firstViewedAt)}`}
              {document.viewCount > 0 &&
                ` · opened ${document.viewCount} ${document.viewCount === 1 ? 'time' : 'times'}`}
              {document.validUntilDate && ` · open until ${formatDay(document.validUntilDate)}`}
            </p>
          </div>
        </header>

        {document.declinedReason && (
          <p className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
            Declined: {document.declinedReason}
          </p>
        )}
        {document.voidReason && (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">Void: {document.voidReason}</p>
        )}
        {document.decisionNote && status === 'accepted' && (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            Accepted, recorded by the studio: {document.decisionNote}
          </p>
        )}

        {document.missing.length > 0 && (isDraft || withClient || status === 'expired') && (
          <MissingDetails missing={document.missing} />
        )}

        <div className="flex flex-wrap gap-2">
          {permissions.includes('documents.send') && isDraft && (
            <SendDialog document={document} onSent={() => setEditing(false)} />
          )}
          {permissions.includes('documents.send') && withClient && <DecisionDialog document={document} />}
          {permissions.includes('documents.update') && isDraft && (
            <Button variant="outline" onClick={() => setEditing((open) => !open)}>
              {editing ? 'Stop editing' : 'Edit the draft'}
            </Button>
          )}
          {permissions.includes('documents.send') && (withClient || status === 'expired') && (
            <SendDialog document={document} />
          )}
          {document.pdfFileId && <DownloadPdfButton fileId={document.pdfFileId} />}
          {permissions.includes('documents.create') &&
            next.map((type) => (
              <DocumentFormDialog
                key={type}
                type={type}
                clientId={document.clientId}
                canUseRateCard={permissions.includes('ratecard.view')}
                onCreated={(created) => router.push(`/documents/${created}`)}
                trigger={<Button variant="ghost">Draft a {DOCUMENT_TYPE_LABELS[type].toLowerCase()}</Button>}
              />
            ))}
          {permissions.includes('documents.void') && status !== 'signed' && status !== 'void' && (
            <VoidDialog document={document} />
          )}
        </div>
      </div>

      {editing && isDraft ? (
        <DocumentDraftEditor
          document={document}
          canUseRateCard={permissions.includes('ratecard.view')}
          onDone={() => setEditing(false)}
        />
      ) : (
        <DocumentBlocks
          blocks={document.blocks}
          lineItems={document.lineItems}
          totals={document.totals}
          currency={document.currency ?? 'NGN'}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-display text-xl font-bold">The chain</h2>
          <ol className="space-y-2">
            {document.chain.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/documents/${row.id}`}
                  aria-current={row.id === document.id ? 'page' : undefined}
                  className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50 ${
                    row.id === document.id ? 'border-foreground' : ''
                  }`}
                >
                  <span className="font-medium">{row.typeLabel}</span>
                  <span className="text-muted-foreground">{row.number ?? 'draft'}</span>
                  <span className="sm:ml-auto">
                    <ToneBadge {...documentStatus(row.status as DocumentStatus)} />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-bold">Versions</h2>
          {document.versions.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-muted-foreground">
              Nothing sent yet. Sending keeps a copy of exactly what the client received.
            </p>
          ) : (
            <ol className="space-y-2">
              {document.versions.map((version) => (
                <li
                  key={version.version}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">Version {version.version}</span>
                  <span className="text-muted-foreground">{dateTime.format(version.createdAt)}</span>
                  {version.changeNote && <span className="text-muted-foreground">· {version.changeNote}</span>}
                  {!version.hasPdf && <span className="text-attention-foreground">· no PDF</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * What the wording promises but the app does not have yet. Sending is refused until each is filled in, so the client
 * never reads a dash where a name or address should be.
 */
function MissingDetails({ missing }: { missing: { label: string; where: string; href?: string }[] }) {
  return (
    <div role="status" className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
      <p className="font-medium">Fill these in before sending:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {missing.map((detail) => (
          <li key={`${detail.label}-${detail.where}`}>
            {detail.label}:{' '}
            {detail.href ? (
              <Link href={detail.href} className="underline underline-offset-4">
                {detail.where}
              </Link>
            ) : (
              detail.where
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
