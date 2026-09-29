'use client';

import { useMutation, useQuery } from 'convex/react';
import { ImagePlus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { sizeAdvice } from '@/lib/image-size-advice';
import { shrinkImage } from '@/lib/shrink-image';

// Getting a picture onto a case study or an insight (13-cms-and-website.md, Editing).
//
// Two ways in, because a case study drafted from a project already has its screenshots sitting in the OS and uploading
// them again would be silly, while a case study written from nothing has no project to take them from.
//
// A heavy image is warned about and never quietly changed. Shrinking is offered as a button, so the file that reaches
// the website is the one somebody chose, or the one they asked for instead.

type Picked = { fileId: Id<'files'>; url: string };

export function ImagePicker({
  table,
  id,
  workId,
  label,
  onPicked,
}: {
  table: 'works' | 'posts';
  id: string;
  /** When a case study, lets it offer what the project already delivered. */
  workId?: Id<'works'>;
  label: string;
  onPicked: (picked: Picked) => void;
}) {
  const uploadUrl = useMutation(api.cms.generateImageUploadUrl);
  const record = useMutation(api.cms.recordCmsImage);
  const fromProject = useQuery(api.cms.projectImages, workId ? { workId } : 'skip');
  const input = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProject, setShowProject] = useState(false);

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const url = await uploadUrl({});
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
      const result = await record({ storageId, name: file.name, contentType: file.type, table, id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onPicked({ fileId: result.fileId, url: result.url ?? '' });
      setPending(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const advice = pending ? sizeAdvice(pending.size) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
          <Upload aria-hidden />
          {label}
        </Button>
        {workId && (fromProject ?? []).length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowProject((open) => !open)}>
            <ImagePlus aria-hidden />
            {showProject ? 'Hide the project’s files' : `From the project (${fromProject!.length})`}
          </Button>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setError(null);
          // Anything worth a word is held back so the warning is read before the upload, not after.
          if (sizeAdvice(file.size).level === 'ok') void send(file);
          else setPending(file);
        }}
      />

      {pending && advice && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className={advice.level === 'refuse' ? 'text-sm text-destructive' : 'text-sm'}>{advice.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const smaller = await shrinkImage(pending);
                  setBusy(false);
                  await send(smaller);
                } catch (caught) {
                  setBusy(false);
                  setError(errorMessage(caught));
                }
              }}
            >
              {busy ? 'Working…' : 'Shrink it and use it'}
            </Button>
            {/* Only offered when the website would actually take it: past the hard limit this is not a choice. */}
            {advice.level === 'warn' && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void send(pending)}>
                Use it as it is
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showProject && (
        <ul className="grid gap-2 sm:grid-cols-3">
          {(fromProject ?? []).map((image) => (
            <li key={image.fileId}>
              <button
                type="button"
                className="w-full overflow-hidden rounded-lg border text-left hover:bg-muted/50"
                onClick={() => {
                  onPicked({ fileId: image.fileId, url: image.url });
                  setShowProject(false);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="h-24 w-full object-cover" />
                <span className="block truncate px-2 py-1 text-xs text-muted-foreground">{image.deliverable}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
