'use client';

import { useMutation, useQuery } from 'convex/react';
import { ImageUploadField, uploadToStorage } from '@/components/app/image-upload-field';
import { Mark } from '@/components/brand/mark';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';

/** Upload, replace or remove the studio logo. */
export function LogoUploader({ logoFileId }: { logoFileId?: Id<'files'> }) {
  const generateUploadUrl = useMutation(api.settings.generateLogoUploadUrl);
  const setLogo = useMutation(api.settings.setLogo);
  const removeLogo = useMutation(api.settings.removeLogo);
  const preview = useQuery(api.files.teamDownloadUrl, logoFileId ? { fileId: logoFileId } : 'skip');

  return (
    <ImageUploadField
      label="Logo file"
      help="PNG, JPEG, WebP, GIF or SVG, up to 10 MB. Used on documents."
      doneMessage="Logo updated."
      hasImage={!!logoFileId}
      preview={
        <div className="flex size-24 shrink-0 items-center justify-center rounded-lg border bg-white p-2">
          {logoFileId && preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; nothing for next/image to optimise
            <img src={preview.url} alt="Current studio logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <Mark size={40} className="text-muted-foreground/40" label="No logo yet" />
          )}
        </div>
      }
      upload={async (file) => {
        const storageId = await uploadToStorage(await generateUploadUrl({}), file);
        const result = await setLogo({
          storageId: storageId as Id<'_storage'>,
          name: file.name,
          contentType: file.type,
        });
        return result.ok ? { ok: true } : { ok: false, message: result.message };
      }}
      remove={async () => {
        await removeLogo({});
      }}
    />
  );
}
