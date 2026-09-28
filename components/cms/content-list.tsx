'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { api } from '@/convex/_generated/api';
import { CONTENT_LABELS, type ContentTable, statusLabel } from '@/lib/cms-display';
import { formatMoment } from '@/lib/support-display';

// One content type's list. Every row says where it stands, because "published" and "published with edits waiting" are
// different things and the difference is what somebody is usually looking for.

export function ContentList({ table }: { table: ContentTable }) {
  const rows = useQuery(api.cms.list, { table });
  const { many, segment } = CONTENT_LABELS[table];

  if (rows === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (rows.length === 0) {
    return <p className="rounded-md border border-dashed p-6 text-muted-foreground">No {many.toLowerCase()} yet.</p>;
  }

  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/cms/${segment}/${row.id}`}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50"
          >
            <span className="min-w-0">
              <span className="font-medium">{row.label}</span>
              {row.slug && <span className="text-muted-foreground"> /{row.slug}</span>}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {row.unpublishedChanges && <Badge variant="secondary">Edits waiting</Badge>}
              <Badge variant={row.status === 'published' ? 'default' : 'outline'}>{statusLabel(row.status)}</Badge>
              <span className="text-sm text-muted-foreground">{formatMoment(row.draftUpdatedAt)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
