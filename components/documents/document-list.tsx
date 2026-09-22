'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentFormDialog } from '@/components/documents/document-form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type DocumentType } from '@/convex/lib/documentBlocks';
import { formatMoney } from '@/convex/lib/money';
import { formatDay } from '@/lib/crm-display';
import {
  CREATABLE_TYPES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPE_LABELS,
  type DocumentStatus,
  documentStatus,
} from '@/lib/documents-display';

/** Every document the viewer can see, newest first (07-documents-and-esign.md, Screens). */
export function DocumentList({
  permissions,
  clientId,
  projectId,
  heading,
}: {
  permissions: string[];
  clientId?: Id<'clients'>;
  projectId?: Id<'projects'>;
  /** Shown above the list when it sits on a client or project page. */
  heading?: string;
}) {
  const router = useRouter();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const documents = useQuery(api.documents.list, {
    clientId,
    projectId,
    type: (type || undefined) as DocumentType | undefined,
    status: status || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {heading && <h2 className="font-display text-xl font-bold">{heading}</h2>}
        <div className="space-y-1">
          <Label htmlFor="document-type-filter" className="text-xs text-muted-foreground">
            Type
          </Label>
          <NativeSelect id="document-type-filter" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Every type</option>
            {CREATABLE_TYPES.map((value) => (
              <option key={value} value={value}>
                {DOCUMENT_TYPE_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="document-status-filter" className="text-xs text-muted-foreground">
            Status
          </Label>
          <NativeSelect id="document-status-filter" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            {DOCUMENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {documentStatus(value).label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {permissions.includes('documents.create') && (
          <div className="sm:ml-auto">
            <DocumentFormDialog
              clientId={clientId}
              projectId={projectId}
              canUseRateCard={permissions.includes('ratecard.view')}
              onCreated={(documentId) => router.push(`/documents/${documentId}`)}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  New document
                </Button>
              }
            />
          </div>
        )}
      </div>

      {documents === undefined ? (
        <p className="text-muted-foreground">Loading documents…</p>
      ) : documents.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">Nothing here yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-3xl text-sm">
            <caption className="sr-only">Documents</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Document
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Client
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Open until
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id} className="border-t hover:bg-accent/50">
                  <td className="px-4 py-3">
                    <Link href={`/documents/${document.id}`} className="block">
                      <span className="block font-medium">{document.title}</span>
                      <span className="block text-muted-foreground">
                        {document.typeLabel}
                        {document.number ? ` · ${document.number}` : ' · draft'}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">{document.clientName}</td>
                  <td className="px-4 py-3">
                    <ToneBadge
                      {...documentStatus(document.status as DocumentStatus, { signingOpen: document.signingOpen })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {document.totals && document.currency
                      ? formatMoney(document.totals.totalMinor, document.currency)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">{document.validUntilDate ? formatDay(document.validUntilDate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
