import { cn } from '@/lib/utils';

/**
 * The studio mark: a solid mass with one part still open. The void sits at 42% across and down, deliberately not a
 * clean quarter. Below 16px the void outline is dropped and the notch left empty (brand kit rules).
 */
export function Mark({ size = 24, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      className={cn('shrink-0', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path fill="currentColor" d="M0 0H57.6V42.1H100V100H0Z" />
      {size >= 16 && <path fill="none" stroke="currentColor" strokeWidth="2.1" d="M58.9 1.3H98.7V40.8H58.9Z" />}
    </svg>
  );
}
