import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// 03-auth-and-permissions.md: modules build functions only through convex/lib/functions.ts.
const CONVEX_DIR = join(import.meta.dirname, '..', '..', 'convex');
const WRAPPERS_FILE = 'lib/functions.ts';
const RAW_BUILDERS = new Set([
  'query',
  'mutation',
  'action',
  'internalQuery',
  'internalMutation',
  'internalAction',
  'httpAction',
  'queryGeneric',
  'mutationGeneric',
  'actionGeneric',
  'internalQueryGeneric',
  'internalMutationGeneric',
  'internalActionGeneric',
  'httpActionGeneric',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function rawBuilderImports(source: string): string[] {
  const found: string[] = [];
  const importPattern = /import\s*(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const [, typeOnly, names, from] of source.matchAll(importPattern)) {
    if (typeOnly || !(from.endsWith('_generated/server') || from === 'convex/server')) continue;
    for (const raw of names.split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      if (!raw.trim().startsWith('type ') && RAW_BUILDERS.has(name)) found.push(name);
    }
  }
  return found;
}

describe('Convex function builders', () => {
  it('detects raw builder imports', () => {
    expect(rawBuilderImports(`import { query, type QueryCtx } from './_generated/server';`)).toEqual(['query']);
    expect(rawBuilderImports(`import { mutation as m } from '../_generated/server';`)).toEqual(['mutation']);
    expect(rawBuilderImports(`import { httpActionGeneric } from 'convex/server';`)).toEqual(['httpActionGeneric']);
    expect(rawBuilderImports(`import { type QueryCtx } from './_generated/server';`)).toEqual([]);
    expect(rawBuilderImports(`import type { query } from './_generated/server';`)).toEqual([]);
    expect(rawBuilderImports(`import { defineSchema } from 'convex/server';`)).toEqual([]);
  });

  it('are only imported raw by the wrappers file', () => {
    const offenders = sourceFiles(CONVEX_DIR)
      .map((path) => ({ file: relative(CONVEX_DIR, path), builders: rawBuilderImports(readFileSync(path, 'utf8')) }))
      .filter(({ file, builders }) => file !== WRAPPERS_FILE && builders.length > 0);

    expect(offenders).toEqual([]);
  });
});
