'use client';

import { useMutation } from 'convex/react';
import { History } from 'lucide-react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatMoment } from '@/lib/support-display';

// Every save leaves one of these (13, Editing). Restoring writes the old version back as the draft and leaves the
// published copy alone, so it is safe to try on something that is live.

export function Revisions({
  revisions,
}: {
  revisions: { id: Id<'contentRevisions'>; editedAt: number; editedByName: string }[];
}) {
  const restore = useMutation(api.cms.restoreRevision);

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-medium">
        <History aria-hidden className="size-4 text-muted-foreground" />
        Earlier versions
      </h2>
      {revisions.length === 0 ? (
        <p className="text-muted-foreground">Nothing yet. A version is kept every time this is saved.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {revisions.map((revision) => (
            <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-sm">
                {revision.editedByName} · {formatMoment(revision.editedAt)}
              </span>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm">
                    Restore
                  </Button>
                }
                title="Restore this version?"
                description="It becomes what you are editing. Nothing on the website changes until you publish, so this is safe to try."
                confirmLabel="Restore it"
                onConfirm={async () => await restore({ revisionId: revision.id })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
