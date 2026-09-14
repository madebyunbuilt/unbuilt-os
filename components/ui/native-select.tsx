import { ChevronDown } from 'lucide-react';
import { type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A styled native <select>, for long lists such as timezones where a native picker is faster and more accessible. */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          'h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent py-1 pr-9 pl-3 text-base shadow-xs outline-none md:text-sm',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
