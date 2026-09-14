'use client';

import { Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { CommandPalette } from '@/components/app/shell/command-palette';
import { NavList } from '@/components/app/shell/nav-list';
import { NotificationsBell } from '@/components/app/shell/notifications-bell';
import { isCommandPaletteKey, isTypingTarget } from '@/components/app/shell/shortcuts';
import { ShortcutsDialog } from '@/components/app/shell/shortcuts-dialog';
import { type ShellUser, UserMenu } from '@/components/app/shell/user-menu';
import { Mark } from '@/components/brand/mark';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { navigationFor } from '@/lib/navigation';
import { type Surface } from '@/lib/surface';

const SURFACE_NAME: Record<Surface, string> = { team: 'Unbuilt OS', portal: 'Client portal' };

function Brand({ surface }: { surface: Surface }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md">
      <Mark size={24} />
      <span className="font-display text-base font-extrabold tracking-tight">{SURFACE_NAME[surface]}</span>
    </Link>
  );
}

/** The frame around every signed-in page on both surfaces: navigation, search, notifications and the account menu. */
export function AppShell({
  surface,
  user,
  permissions,
  children,
}: {
  surface: Surface;
  user: ShellUser;
  permissions: readonly string[];
  children: ReactNode;
}) {
  const sections = useMemo(() => navigationFor(surface, permissions), [surface, permissions]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCommandPaletteKey(event)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === '?' && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex min-h-full flex-1">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto border-r lg:flex">
        <div className="flex h-14 items-center px-5">
          <Brand surface={surface} />
        </div>
        <NavList sections={sections} />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 overflow-y-auto p-0">
          <SheetHeader className="h-14 justify-center border-b px-5">
            <SheetTitle asChild>
              <div>
                <Brand surface={surface} />
              </div>
            </SheetTitle>
            <SheetDescription className="sr-only">Main navigation</SheetDescription>
          </SheetHeader>
          <NavList sections={sections} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </Button>
          <div className="lg:hidden">
            <Mark size={22} label={SURFACE_NAME[surface]} />
          </div>

          <Button
            variant="outline"
            className="ml-auto h-9 justify-start gap-2 text-muted-foreground sm:ml-0 sm:w-72"
            aria-label="Open command palette"
            onClick={() => setPaletteOpen(true)}
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden sm:inline">Search or jump to…</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-sans text-xs sm:inline">⌘K</kbd>
          </Button>

          <div className="flex items-center gap-1 sm:ml-auto">
            <NotificationsBell surface={surface} />
            <UserMenu user={user} onShowShortcuts={() => setShortcutsOpen(true)} />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sections={sections}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
