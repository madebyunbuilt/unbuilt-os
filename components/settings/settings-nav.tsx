'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActivePath } from '@/lib/navigation';
import { type SettingsSection } from '@/lib/settings-sections';
import { cn } from '@/lib/utils';

export function SettingsNav({ sections }: { sections: readonly SettingsSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {sections.map((section) => {
          const itemClass = 'block rounded-md px-3 py-2 text-sm whitespace-nowrap';
          if (!section.built) {
            return (
              <li key={section.href}>
                <span aria-disabled="true" className={cn(itemClass, 'cursor-not-allowed text-draft')}>
                  {section.label}
                  <span className="ml-2 text-[0.6875rem] tracking-wide uppercase">Not built yet</span>
                </span>
              </li>
            );
          }
          const active = isActivePath(section.href, pathname);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(itemClass, 'font-medium hover:bg-accent', active && 'bg-accent')}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
