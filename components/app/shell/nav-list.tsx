'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavIcon } from '@/components/app/shell/nav-icon';
import { isActivePath, type NavSection } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Built modules are links. Modules that are not built yet are listed in the drawing colour and cannot be opened, so
 * people can see what is coming without landing on a missing page.
 */
export function NavList({ sections, onNavigate }: { sections: readonly NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {sections.map((section, index) => (
        <div key={section.label ?? index}>
          {section.label && (
            <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {section.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const itemClass = 'flex items-center gap-3 rounded-md px-2 py-2 text-sm';
              if (!item.built) {
                return (
                  <li key={item.href}>
                    <span aria-disabled="true" className={cn(itemClass, 'cursor-not-allowed text-draft')}>
                      <NavIcon name={item.icon} className="size-4" />
                      <span className="flex-1">{item.label}</span>
                      <span className="text-[0.6875rem] tracking-wide uppercase">Not built yet</span>
                    </span>
                  </li>
                );
              }
              const active = isActivePath(item.href, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      itemClass,
                      'font-medium hover:bg-accent',
                      active && 'bg-primary text-primary-foreground hover:bg-primary',
                    )}
                  >
                    <NavIcon name={item.icon} className="size-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
