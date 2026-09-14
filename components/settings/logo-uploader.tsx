'use client';

import { useMutation, useQuery } from 'convex/react';
import { type ChangeEvent, useRef, useState } from 'react';
import { Mark } from '@/components/brand/mark';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { FILE_CONTEXTS } from '@/convex/lib/files';
import { errorMessage } from '@/lib/convex-error';

const LOGO_TYPES = Object.keys(FILE_CONTEXTS.image.types);
const MAX_BYTES = FILE_CONTEXTS.image.maxBytes;

type Status = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'error'; message: string } | { kind: 'done' };

/** Upload, replace or remove the studio logo. The server repeats every check made here. */
export function LogoUploader({ logoFileId }: { logoFileId?: Id<'files'> }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const generateUploadUrl = useMutation(api.settings.generateLogoUploadUrl);
  const setLogo = useMutation(api.settings.setLogo);
  const removeLogo = useMutation(api.settings.removeLogo);
  const preview = useQuery(api.files.teamDownloadUrl, logoFileId ? { fileId: logoFileId } : 'skip');

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setStatus({ kind: 'error', message: 'Use a PNG, JPEG, WebP, GIF or SVG image.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'error', message: 'The logo can be at most 10 MB.' });
      return;
    }

    setStatus({ kind: 'uploading' });
    try {
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error('Upload failed');
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
      const result = await setLogo({ storageId, name: file.name, contentType: file.type });
      setStatus(result.ok ? { kind: 'done' } : { kind: 'error', message: result.message });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error, 'The logo could not be uploaded. Try again.') });
    }
  }

  async function remove() {
    setStatus({ kind: 'uploading' });
    try {
      await removeLogo({});
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    }
  }

  const busy = status.kind === 'uploading';

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex size-24 shrink-0 items-center justify-center rounded-lg border bg-white p-2">
        {logoFileId && preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; nothing for next/image to optimise
          <img src={preview.url} alt="Current studio logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <Mark size={40} className="text-muted-foreground/40" label="No logo yet" />
        )}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <label htmlFor="logo-file" className="sr-only">
            Logo file
          </label>
          <input
            ref={input}
            type="file"
            accept={LOGO_TYPES.join(',')}
            className="sr-only"
            id="logo-file"
            onChange={(event) => void upload(event)}
            disabled={busy}
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Working…' : logoFileId ? 'Replace logo' : 'Upload logo'}
          </Button>
          {logoFileId && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">PNG, JPEG, WebP, GIF or SVG, up to 10 MB. Used on documents.</p>
        <div aria-live="polite" className="text-sm">
          {status.kind === 'done' && <p className="text-muted-foreground">Logo updated.</p>}
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
