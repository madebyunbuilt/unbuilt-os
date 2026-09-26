'use client';

import { Keyboard, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { NavIcon } from '@/components/app/shell/nav-icon';
import { useTheme } from '@/components/app/theme-provider';
import { useSignOut } from '@/components/auth/use-sign-out';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { type Destination, destinationsFor, matches, search, trailLabel } from '@/lib/destinations';
import { type NavIcon as NavIconName, type NavSection } from '@/lib/navigation';
import { type Surface } from '@/lib/surface';

/**
 * The ⌘K palette (14-platform.md, Search and command palette). It searches everywhere a person can go, including
 * settings buried inside a page: somebody looking for the VAT rate knows what it is called, not that it lives under
 * Billing. Search across records and quick actions such as "New invoice" join as their modules land.
 */
/** A destination's own icon where it is a page; otherwise the one belonging to the section it sits under. */
function iconFor(destination: Destination, sections: readonly NavSection[]): NavIconName {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.href === destination.href) return item.icon;
      if (destination.href.startsWith(`${item.href}/`) || destination.href.startsWith(`${item.href}#`))
        return item.icon;
    }
  }
  return 'settings';
}

export function CommandPalette({
  open,
  onOpenChange,
  surface,
  sections,
  permissions,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: Surface;
  sections: readonly NavSection[];
  permissions: readonly string[];
  onShowShortcuts: () => void;
}) {
  const router = useRouter();
  const { setPreference } = useTheme();
  const { signOut } = useSignOut();
  const [query, setQuery] = useState('');

  const destinations = useMemo(() => destinationsFor(surface, sections), [surface, sections]);
  const found = useMemo(() => search(destinations, query, permissions), [destinations, query, permissions]);

  const run = (action: () => void) => {
    onOpenChange(false);
    setQuery('');
    action();
  };

  const goTo = (destination: Destination) => {
    if (destination.built === false) return;
    run(() => router.push(destination.href));
  };

  // The things the palette does rather than goes to. They answer to what was typed like everything else, so a query
  // that matches nothing leaves the list genuinely empty instead of offering Sign out.
  const commands = useMemo(() => {
    const all = [
      {
        label: 'Match system theme',
        icon: Monitor,
        keywords: ['appearance', 'automatic'],
        run: () => setPreference('system'),
      },
      { label: 'Light theme', icon: Sun, keywords: ['appearance', 'day'], run: () => setPreference('light') },
      { label: 'Dark theme', icon: Moon, keywords: ['appearance', 'night'], run: () => setPreference('dark') },
      { label: 'Keyboard shortcuts', icon: Keyboard, keywords: ['keys', 'help'], run: onShowShortcuts },
      { label: 'Sign out', icon: LogOut, keywords: ['log out', 'leave', 'account'], run: () => void signOut() },
    ];
    return all.filter((command) =>
      matches({ label: command.label, trail: [], href: '', keywords: command.keywords }, query),
    );
  }, [query, setPreference, onShowShortcuts, signOut]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      // Matching and ranking happen in lib/destinations.ts, which knows about trails and keywords; cmdk's own filter
      // sees only each item's value and would throw away everything found by a keyword.
      shouldFilter={false}
      title="Command palette"
      description="Go to a page or run a command"
    >
      <CommandInput placeholder="Search pages, settings and commands…" value={query} onValueChange={setQuery} />
      <CommandList>
        {found.length === 0 && commands.length === 0 && <CommandEmpty>No matches.</CommandEmpty>}
        {found.length > 0 && (
          <CommandGroup heading="Go to">
            {found.map((destination) => (
              <CommandItem
                key={destination.href}
                value={destination.href}
                disabled={destination.built === false}
                onSelect={() => goTo(destination)}
              >
                <NavIcon name={iconFor(destination, sections)} />
                <span className="min-w-0">
                  {/* The trail first, small: what somebody needs is to recognise where it lives, then read the name. */}
                  {destination.trail.length > 0 && (
                    <span className="block text-xs text-muted-foreground">{trailLabel(destination)}</span>
                  )}
                  <span className="block">{destination.label}</span>
                </span>
                {destination.built === false && <span className="ml-auto text-xs text-draft">Not built yet</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {commands.length > 0 && found.length > 0 && <CommandSeparator />}
        {commands.length > 0 && (
          <CommandGroup heading="Commands">
            {commands.map((command) => (
              <CommandItem key={command.label} value={command.label} onSelect={() => run(command.run)}>
                <command.icon />
                {command.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
