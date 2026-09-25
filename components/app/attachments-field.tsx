'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { uploadToStorage } from '@/components/app/image-upload-field';
import { type Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Files attached to a message, on either surface (09-support-and-sla.md, Tickets). Chosen files are held here and
// only uploaded when the message is sent, so somebody who changes their mind leaves nothing behind.

export const MAX_ATTACHMENTS = 5;

export type Upload = { storageId: Id<'_storage'>; name: string; contentType: string };

export function useAttachments(generateUploadUrl: () => Promise<string>) {
  const [files, setFiles] = useState<File[]>([]);

  return {
    files,
    add: (chosen: FileList | null) => {
      if (!chosen) return;
      setFiles((held) => [...held, ...Array.from(chosen)].slice(0, MAX_ATTACHMENTS));
    },
    remove: (index: number) => setFiles((held) => held.filter((_, at) => at !== index)),
    clear: () => setFiles([]),
    /** Uploads what was chosen and returns what the mutation needs. Empty when nothing was attached. */
    upload: async (): Promise<Upload[]> =>
      await Promise.all(
        files.map(async (file) => ({
          storageId: (await uploadToStorage(await generateUploadUrl(), file)) as Id<'_storage'>,
          name: file.name,
          // Some browsers give nothing for an unfamiliar extension; the server decides either way.
          contentType: file.type || 'application/octet-stream',
        })),
      ),
  };
}

const KB = 1024;

function size(bytes: number): string {
  return bytes < KB * KB ? `${Math.max(1, Math.round(bytes / KB))} KB` : `${(bytes / (KB * KB)).toFixed(1)} MB`;
}

export function AttachmentsField({
  id,
  label = 'Attach a file',
  attachments,
  disabled,
}: {
  id: string;
  label?: string;
  attachments: ReturnType<typeof useAttachments>;
  disabled?: boolean;
}) {
  const full = attachments.files.length >= MAX_ATTACHMENTS;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="file"
        multiple
        disabled={disabled || full}
        onChange={(event) => {
          attachments.add(event.target.files);
          // Cleared so choosing the same file twice in a row still registers.
          event.target.value = '';
        }}
      />
      <p className="text-xs text-muted-foreground">
        {full
          ? `That is the ${MAX_ATTACHMENTS} files you can attach to one message.`
          : 'Images, PDFs and documents, up to 10 MB each.'}
      </p>
      {attachments.files.length > 0 && (
        <ul className="space-y-1">
          {attachments.files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm">
                {file.name} <span className="text-muted-foreground">({size(file.size)})</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => attachments.remove(index)}
              >
                <X aria-hidden />
                <span className="sr-only">Remove {file.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
