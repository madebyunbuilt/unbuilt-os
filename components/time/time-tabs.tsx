'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** My week and, for approvers, the weeks waiting on them. */
export function TimeTabs({ canApprove }: { canApprove: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { label: 'My week', href: '/time' },
    ...(canApprove ? [{ label: 'Approvals', href: '/time/approvals' }] : []),
  ];

  return (
    <nav aria-label="Time sections" className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap hover:text-foreground',
                  active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
