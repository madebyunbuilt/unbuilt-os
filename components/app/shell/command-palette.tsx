'use client';

import { Keyboard, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
import { type NavSection } from '@/lib/navigation';

/**
 * The ⌘K palette. For now it jumps to pages and runs account actions; search across records and quick actions such as
 * "New invoice" join as their modules land (14-platform.md, Search and command palette).
 */
export function CommandPalette({
  open,
  onOpenChange,
  sections,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: readonly NavSection[];
  onShowShortcuts: () => void;
}) {
  const router = useRouter();
  const { setPreference } = useTheme();
  const { signOut } = useSignOut();
  const pages = sections.flatMap((section) => section.items);

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Go to a page or run a command"
    >
      <CommandInput placeholder="Type a page or command…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          {pages.map((page) => (
            <CommandItem
              key={page.href}
              value={`go ${page.label}`}
              disabled={!page.built}
              onSelect={() => run(() => router.push(page.href))}
            >
              <NavIcon name={page.icon} />
              {page.label}
              {!page.built && <span className="ml-auto text-xs text-draft">Not built yet</span>}
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
