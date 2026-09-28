'use client';

import { useMutation, useQuery } from 'convex/react';
import { CloudUpload, Eye, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { errorMessage } from '@/lib/convex-error';
import { type ContentTable, statusLabel } from '@/lib/cms-display';

// Publishing, and saying what is happening while it does (13-cms-and-website.md, Publishing). A publish waits for the
// deploy window before the website is rebuilt, so the wait is shown and counted down: a minute of silence after
// pressing Publish reads as a broken button.

function Countdown({ deployAt }: { deployAt: number }) {
  const [left, setLeft] = useState(() => Math.max(0, deployAt - Date.now()));
  useEffect(() => {
    // Against the deadline, not by counting ticks, so a backgrounded tab comes back with the right number.
    const timer = setInterval(() => setLeft(Math.max(0, deployAt - Date.now())), 250);
    return () => clearInterval(timer);
  }, [deployAt]);
  const seconds = Math.ceil(left / 1000);
  return <>{seconds > 0 ? `in ${seconds}s` : 'now'}</>;
}

export function PublishBar({
  table,
  id,
  label,
  status,
  unpublishedChanges,
  blockers,
}: {
  table: ContentTable;
  id: string;
  label: string;
  status: string;
  unpublishedChanges: boolean;
  blockers: { field: string; message: string }[];
}) {
  const publish = useMutation(api.cmsPublish.publish);
  const unpublish = useMutation(api.cmsPublish.unpublish);
  const deployNow = useMutation(api.cmsPublish.deployNow);
  const previewToken = useMutation(api.siteContent.previewToken);
  const state = useQuery(api.cmsPublish.deployState, {});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = blockers.length === 0;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status === 'published' ? 'default' : 'outline'}>{statusLabel(status)}</Badge>
          {unpublishedChanges && <Badge variant="secondary">Edited since it went out</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              setError(null);
              try {
                const { token } = await previewToken({ table, id });
                // The token is what the website's preview deployment needs; the studio copies it into that URL.
                await navigator.clipboard.writeText(token);
                setError('Preview token copied. Paste it into the preview site’s ?preview= link.');
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          >
            <Eye aria-hidden />
            Preview token
          </Button>
          {status === 'published' ? (
            <ConfirmDialog
              trigger={<Button variant="outline">Take it down</Button>}
              title={`Take ${label} off the website?`}
              description="It stops being published at the next build. What you have written is kept, so it can go back up as it is."
              confirmLabel="Take it down"
              onConfirm={async () => await unpublish({ table, id })}
            />
          ) : null}
          <Button
            type="button"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await publish({ table, id });
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            <CloudUpload aria-hidden />
            {status === 'published' ? 'Publish changes' : 'Publish'}
          </Button>
        </div>
      </div>

      {!ready && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Before this can be published</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {blockers.map((blocker) => (
              <li key={`${blocker.field}-${blocker.message}`}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {state?.pending && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
          <p aria-live="polite" className="text-muted-foreground">
            {state.pending.changes.length === 1 ? '1 change' : `${state.pending.changes.length} changes`} waiting. The
            website rebuilds <Countdown deployAt={state.pending.deployAt} />.
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void deployNow({})}>
            Rebuild now
          </Button>
        </div>
      )}

      {state?.recent[0]?.status === 'failed' && <FailedDeploy id={state.recent[0].id} error={state.recent[0].error} />}
    </div>
  );
}

/** A deploy that did not happen is worth saying out loud: the content is published and the website is not showing it. */
function FailedDeploy({ id, error }: { id: string; error?: string }) {
  const retry = useMutation(api.cmsPublish.retryDeploy);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
      <p className="text-destructive">
        The last rebuild did not happen{error ? `: ${error}` : '.'} The content is published; the website has not caught
        up.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => void retry({ publishId: id as never })}>
        <RotateCcw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
