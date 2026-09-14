import { memberStatus } from '@/lib/team-display';
import { cn } from '@/lib/utils';

const TONE_CLASS = {
  draft: 'bg-draft text-draft-foreground',
  attention: 'bg-attention text-attention-foreground',
  built: 'border border-foreground text-foreground',
  muted: 'bg-muted text-muted-foreground',
} as const;

export function StatusBadge({ member }: { member: Parameters<typeof memberStatus>[0] }) {
  const { label, tone } = memberStatus(member);
  return (
    <span
      className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE_CLASS[tone])}
    >
      {label}
    </span>
  );
}
