import { ConvexError, type GenericId } from 'convex/values';
import { type TableNames } from '../_generated/dataModel';
import { type DatabaseWriter } from '../_generated/server';
import schema from '../schema';

// Audit log rules: docs/spec/03-auth-and-permissions.md (Audit log). teamMutation and portalMutation hand handlers a
// database that records one entry per successful write. The log itself is append-only.

/** Fields replaced with REDACTED in audit diffs. One list per table, shared with the sensitive-field serializers. */
export const SENSITIVE_FIELDS: Partial<Record<TableNames, readonly string[]>> = {
  teamMembers: ['costRateMinor', 'billRateMinor'],
};

export const REDACTED = '[redacted]';

const APPEND_ONLY_TABLES: ReadonlySet<string> = new Set<TableNames>(['auditLog']);
const TABLE_NAMES = Object.keys(schema.tables) as TableNames[];

export type AuditActor = {
  actorKind: 'team' | 'client' | 'system';
  actorId?: string;
  authUserId?: string;
  permission?: string;
  ip?: string;
  userAgent?: string;
};

type Fields = Record<string, unknown>;

function redact(table: TableNames, doc: Fields): Fields {
  const sensitive = SENSITIVE_FIELDS[table] ?? [];
  const result: Fields = {};
  for (const [field, value] of Object.entries(doc)) {
    result[field] = sensitive.includes(field) && value !== undefined ? REDACTED : value;
  }
  return result;
}

/** The fields that differ between two versions of a document, ignoring Convex system fields. */
export function fieldDiff(before: Fields | null, after: Fields | null): { before?: Fields; after?: Fields } {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changedBefore: Fields = {};
  const changedAfter: Fields = {};
  for (const field of fields) {
    if (field === '_id' || field === '_creationTime') continue;
    const a = before?.[field];
    const b = after?.[field];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (before && field in before) changedBefore[field] = a;
    if (after && field in after) changedAfter[field] = b;
  }
  return {
    ...(before ? { before: changedBefore } : {}),
    ...(after ? { after: changedAfter } : {}),
  };
}

/** Appends one audit entry. The only code path that writes to `auditLog`. */
export async function appendAuditEntry(
  db: DatabaseWriter,
  actor: AuditActor,
  entry: {
    action: 'insert' | 'update' | 'delete' | 'read';
    table: TableNames;
    recordId: string;
    before?: Fields | null;
    after?: Fields | null;
  },
): Promise<void> {
  const diff = fieldDiff(
    entry.before ? redact(entry.table, entry.before) : null,
    entry.after ? redact(entry.table, entry.after) : null,
  );
  await db.insert('auditLog', {
    ...actor,
    action: entry.action,
    table: entry.table,
    recordId: entry.recordId,
    diff,
    at: Date.now(),
  });
}

function refuseAppendOnly(table: string) {
  if (APPEND_ONLY_TABLES.has(table)) {
    throw new ConvexError({ code: 'audit.appendOnly', message: `${table} cannot be written directly` });
  }
}

type AnyId = GenericId<TableNames>;

/** A DatabaseWriter that audits every insert, patch, replace and delete, and refuses writes to append-only tables. */
export function auditedDatabase(db: DatabaseWriter, actor: AuditActor): DatabaseWriter {
  const tableOf = (id: AnyId): TableNames => {
    const table = TABLE_NAMES.find((name) => db.normalizeId(name, id) !== null);
    if (!table)
      throw new ConvexError({ code: 'audit.unknownTable', message: 'Cannot audit a write to an unknown table' });
    return table;
  };

  const resolve = (args: unknown[]): { table: TableNames; id: AnyId; rest: unknown[] } =>
    typeof args[0] === 'string' &&
    TABLE_NAMES.includes(args[0] as TableNames) &&
    args.length >= 2 &&
    typeof args[1] === 'string'
      ? { table: args[0] as TableNames, id: args[1] as AnyId, rest: args.slice(2) }
      : { table: tableOf(args[0] as AnyId), id: args[0] as AnyId, rest: args.slice(1) };

  const writer = {
    get: db.get.bind(db),
    query: db.query.bind(db),
    normalizeId: db.normalizeId.bind(db),
    system: db.system,

    async insert(table: TableNames, value: Fields) {
      refuseAppendOnly(table);
      const id = await db.insert(table, value as never);
      await appendAuditEntry(db, actor, { action: 'insert', table, recordId: id, after: await db.get(table, id) });
      return id;
    },

    async patch(...args: unknown[]) {
      const { table, id, rest } = resolve(args);
      refuseAppendOnly(table);
      const before = await db.get(table, id);
      await db.patch(table, id as never, rest[0] as never);
      await appendAuditEntry(db, actor, {
        action: 'update',
        table,
        recordId: id,
        before,
        after: await db.get(table, id),
      });
    },

    async replace(...args: unknown[]) {
      const { table, id, rest } = resolve(args);
      refuseAppendOnly(table);
      const before = await db.get(table, id);
      await db.replace(table, id as never, rest[0] as never);
      await appendAuditEntry(db, actor, {
        action: 'update',
        table,
        recordId: id,
        before,
        after: await db.get(table, id),
      });
    },

    async delete(...args: unknown[]) {
      const { table, id } = resolve(args);
      refuseAppendOnly(table);
      const before = await db.get(table, id);
      await db.delete(table, id as never);
      await appendAuditEntry(db, actor, { action: 'delete', table, recordId: id, before });
    },
  };

  return writer as unknown as DatabaseWriter;
}
