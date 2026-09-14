'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { initials } from '@/lib/team-display';
import { cn } from '@/lib/utils';

/** A member's photo through a signed link, or their initials. Decorative: the name is always shown next to it. */
export function MemberAvatar({
  name,
  avatarFileId,
  size = 'md',
}: {
  name: string;
  avatarFileId?: Id<'files'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const preview = useQuery(api.files.teamDownloadUrl, avatarFileId ? { fileId: avatarFileId } : 'skip');
  const sizeClass = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-16 text-lg' }[size];
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-semibold text-primary-foreground',
        sizeClass,
      )}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL
        <img src={preview.url} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
