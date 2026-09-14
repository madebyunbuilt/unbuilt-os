'use client';

import { type ChangeEvent, type ReactNode, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FILE_CONTEXTS } from '@/convex/lib/files';
import { errorMessage } from '@/lib/convex-error';

const IMAGE_TYPES = Object.keys(FILE_CONTEXTS.image.types);
const MAX_BYTES = FILE_CONTEXTS.image.maxBytes;

export type ImageUploadResult = { ok: true } | { ok: false; message: string };

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'done' };

/**
 * Pick, upload and remove one image. `upload` receives a file that passed the browser checks and must return the
 * server's verdict; the server repeats every check.
 */
export function ImageUploadField({
  preview,
  hasImage,
  label,
  help,
  upload,
  remove,
  doneMessage,
}: {
  preview: ReactNode;
  hasImage: boolean;
  label: string;
  help: string;
  upload: (file: File) => Promise<ImageUploadResult>;
  remove: () => Promise<void>;
  doneMessage: string;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setStatus({ kind: 'error', message: 'Use a PNG, JPEG, WebP, GIF or SVG image.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'error', message: 'The image can be at most 10 MB.' });
      return;
    }
    setStatus({ kind: 'busy' });
    try {
      const result = await upload(file);
      setStatus(result.ok ? { kind: 'done' } : { kind: 'error', message: result.message });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error, 'The image could not be uploaded. Try again.') });
    }
  }

  async function onRemove() {
    setStatus({ kind: 'busy' });
    try {
      await remove();
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    }
  }

  const busy = status.kind === 'busy';
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {preview}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <label htmlFor={inputId} className="sr-only">
            {label}
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            className="sr-only"
            onChange={(event) => void onChange(event)}
            disabled={busy}
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Working…' : hasImage ? 'Replace' : 'Upload'}
          </Button>
          {hasImage && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void onRemove()}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{help}</p>
        <div aria-live="polite" className="text-sm">
          {status.kind === 'done' && <p className="text-muted-foreground">{doneMessage}</p>}
          {status.kind === 'error' && (
            <p role="alert" className="text-destructive">
              {status.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Uploads a file to a Convex storage upload URL and returns its storage id. */
export async function uploadToStorage(uploadUrl: string, file: File): Promise<string> {
  const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  if (!response.ok) throw new Error('Upload failed');
  return ((await response.json()) as { storageId: string }).storageId;
}
