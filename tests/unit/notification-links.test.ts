import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// 14-platform.md, Notifications: every notification carries an in-app path, and a path that leads nowhere is worse
// than none — the person clicks through from a real event and lands on a 404. These are written in Convex, far from
// the routes they name, so nothing else would catch a rename or a wrong prefix.

const ROOT = join(import.meta.dirname, '..', '..');
const CONVEX_DIR = join(ROOT, 'convex');
const APP_DIR = join(ROOT, 'app');

/**
 * Paths that have no page yet, with the step that brings them. Anything else must resolve today, so this list is the
 * whole of what is knowingly ahead of the screens.
 */
const NOT_BUILT_YET: Record<string, string> = {
  '/billing/bills': 'the bills screen, with the rest of the step 9 screens',
  '/portal/projects/:param': 'the client portal, step 10',
};

function filesIn(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : filesIn(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

/** Every route the App Router serves, as a path with :param in place of each dynamic segment. */
function routes(): Set<string> {
  const pages = filesIn(APP_DIR, (name) => name === 'page.tsx');
  return new Set(
    pages.map((path) => {
      const segments = relative(APP_DIR, path)
        .split(/[\\/]/)
        .slice(0, -1)
        // Route groups such as (team) are folders only; they are not in the URL.
        .filter((segment) => !segment.startsWith('('))
        .map((segment) => (segment.startsWith('[') ? ':param' : segment));
      return `/${segments.join('/')}`;
    }),
  );
}

/** The links Convex puts on notifications, with each ${...} standing for one segment. */
function notificationLinks(): { file: string; link: string }[] {
  const sources = filesIn(CONVEX_DIR, (name) => /\.ts$/.test(name) && name.split('.').length === 2);
  const found: { file: string; link: string }[] = [];
  for (const path of sources) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/link:\s*`([^`]+)`/g)) {
      const link = match[1].split('?')[0].replace(/\$\{[^}]+\}/g, ':param');
      // A link built from a variable rather than written out cannot be checked here.
      if (link.startsWith('/')) found.push({ file: relative(ROOT, path), link });
    }
  }
  return found;
}

describe('notification links', () => {
  it('all lead to a page that exists', () => {
    const known = routes();
    const broken = notificationLinks()
      .filter(({ link }) => !known.has(link) && !(link in NOT_BUILT_YET))
      .map(({ file, link }) => `${file} → ${link}`);
    expect([...new Set(broken)]).toEqual([]);
  });

  it('knows which of them are waiting on a screen', () => {
    const known = routes();
    // A path listed as unbuilt that now exists should come off the list, so it starts being checked properly.
    const built = Object.keys(NOT_BUILT_YET).filter((link) => known.has(link));
    expect(built).toEqual([]);
  });
});
