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
import { type Destination, destinationsFor, search, trailLabel } from '@/lib/destinations';
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

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Go to a page or run a command"
    >
      <CommandInput placeholder="Search pages, settings and commands…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
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
        <CommandSeparator />
        <CommandGroup heading="Appearance">
          <CommandItem value="theme system" onSelect={() => run(() => setPreference('system'))}>
            <Monitor />
            Match system theme
          </CommandItem>
          <CommandItem value="theme light" onSelect={() => run(() => setPreference('light'))}>
            <Sun />
            Light theme
          </CommandItem>
          <CommandItem value="theme dark" onSelect={() => run(() => setPreference('dark'))}>
            <Moon />
            Dark theme
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem value="keyboard shortcuts" onSelect={() => run(onShowShortcuts)}>
            <Keyboard />
            Keyboard shortcuts
          </CommandItem>
          <CommandItem value="sign out" onSelect={() => run(() => void signOut())}>
            <LogOut />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
