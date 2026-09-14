import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// 03-auth-and-permissions.md: the audit log is append-only, and there is no code path that modifies or deletes entries.
// Only convex/lib/audit.ts may name the table in code; everything else goes through appendAuditEntry or auditedDatabase.
const CONVEX_DIR = join(import.meta.dirname, '..', '..', 'convex');
const ALLOWED = new Set(['lib/audit.ts', 'schema.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourceFiles(path);
    // Test files and fixtures deliberately try to tamper with the log.
    return /\.tsx?$/.test(entry.name) && entry.name.split('.').length === 2 ? [path] : [];
  });
}

describe('audit log', () => {
  it('is only referenced by the audit library and the schema', () => {
    const offenders = sourceFiles(CONVEX_DIR)
      .map((path) => relative(CONVEX_DIR, path))
      .filter((file) => !ALLOWED.has(file) && /['"]auditLog['"]/.test(readFileSync(join(CONVEX_DIR, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
