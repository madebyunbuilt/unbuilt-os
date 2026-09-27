import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { destinationsFor } from '@/lib/destinations';
import { navigationFor } from '@/lib/navigation';
import { PORTAL_PERMISSIONS, TEAM_PERMISSIONS } from '@/convex/lib/permissions';

// The palette sends people to these, so a stale entry is worse than a missing one: search would confidently take
// somebody somewhere wrong. A setting renamed or moved should fail here rather than in front of a client.

const ROOT = join(import.meta.dirname, '..', '..');
const APP_DIR = join(ROOT, 'app');
const everything: string[] = [...TEAM_PERMISSIONS, ...PORTAL_PERMISSIONS];

function filesIn(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : filesIn(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

/** Every route the App Router serves, with :param for each dynamic segment, both surfaces' spellings. */
function routes(): Set<string> {
  const paths = new Set(
    filesIn(APP_DIR, (name) => name === 'page.tsx').map((path) => {
      const segments = relative(APP_DIR, path)
        .split(/[\\/]/)
        .slice(0, -1)
        .filter((segment) => !segment.startsWith('('))
        .map((segment) => (segment.startsWith('[') ? ':param' : segment));
      return `/${segments.join('/')}`;
    }),
  );
  for (const route of [...paths]) {
    if (route === '/portal') paths.add('/');
    else if (route.startsWith('/portal/')) paths.add(route.slice('/portal'.length));
  }
  return paths;
}

/** Every id the app renders, which is where an anchor has to land. */
function anchors(): Set<string> {
  const sources = [
    ...filesIn(join(ROOT, 'components'), (name) => name.endsWith('.tsx') && !name.includes('.test.')),
    ...filesIn(APP_DIR, (name) => name.endsWith('.tsx')),
  ];
  const found = new Set<string>();
  for (const path of sources) {
    for (const match of readFileSync(path, 'utf8').matchAll(/id="([a-zA-Z0-9-]+)"/g)) found.add(match[1]);
  }
  return found;
}

const all = [
  ...destinationsFor('team', navigationFor('team', everything)),
  ...destinationsFor('portal', navigationFor('portal', everything)),
];

describe('everywhere the palette can send somebody', () => {
  it('is a page that exists', () => {
    const known = routes();
    const broken = all
      .filter((destination) => destination.built !== false)
      .map((destination) => destination.href.split('#')[0])
      .filter((path) => !known.has(path));
    expect([...new Set(broken)]).toEqual([]);
  });

  it('lands on a heading that exists, where it names one', () => {
    const known = anchors();
    const missing = all
      .map((destination) => destination.href.split('#')[1])
      .filter((anchor): anchor is string => Boolean(anchor))
      .filter((anchor) => !known.has(anchor));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('asks for a permission that exists, so nothing is unreachable by a typo', () => {
    const real = new Set(everything);
    const unknown = all.flatMap((destination) => (destination.anyOf ?? []).filter((key) => !real.has(key)));
    expect([...new Set(unknown)]).toEqual([]);
  });
});
