import { ConvexError, type GenericId } from 'convex/values';
import { type TableNames } from '../_generated/dataModel';
import { type DatabaseWriter } from '../_generated/server';
import schema from '../schema';

// Audit log rules: docs/spec/03-auth-and-permissions.md (Audit log). teamMutation and portalMutation hand handlers a
// database that records one entry per successful write. The log itself is append-only.

/** Fields replaced with REDACTED in audit diffs. One list per table, shared with the sensitive-field serializers. */
export const SENSITIVE_FIELDS: Partial<Record<TableNames, readonly string[]>> = {
  teamMembers: ['costRateMinor', 'billRateMinor'],
  timeEntries: ['costRateMinor', 'billRateMinor'],
  orgSettings: ['bankAccounts'],
  vendors: ['bankDetails'],
  // Signers carry the hash of their emailed code, and six digits are quick to recover from a hash.
  signatureRequests: ['signers'],
  signingLinks: ['tokenHash'],
  // Ciphertext is not plaintext, but an audit diff is the wrong place to accumulate copies of it, and an IV beside it
  // tells a reader nothing they are entitled to. The label, kind and URL still show, so an edit is still legible.
  vaultItems: ['usernameCiphertext', 'secretCiphertext', 'notesCiphertext', 'iv'],
};

export const REDACTED = '[redacted]';

/**
 * `vaultAccessLogs` joins the audit log here: the spec keeps the access log when the item it describes is deleted, so
 * no team or portal mutation may edit or remove an entry. The internal mutation that writes one uses the plain
 * database, which is the only door left.
 */
const APPEND_ONLY_TABLES: ReadonlySet<string> = new Set<TableNames>(['auditLog', 'vaultAccessLogs']);
/**
 * Operational data that is not a change anyone makes to a record (the idle-timeout heartbeat, public rate-limit
 * counters): auditing it would bury the log. Still refused in append-only tables; nothing else skips the log.
 */
const UNAUDITED_TABLES: ReadonlySet<string> = new Set<TableNames>(['sessionActivity', 'publicRateLimits']);
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
  // Diff first, then redact, so a change to a sensitive field is still recorded, without its values.
  const changed = fieldDiff(entry.before ?? null, entry.after ?? null);
  const diff = {
    ...(changed.before ? { before: redact(entry.table, changed.before) } : {}),
    ...(changed.after ? { after: redact(entry.table, changed.after) } : {}),
  };
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
      if (UNAUDITED_TABLES.has(table)) return id;
      await appendAuditEntry(db, actor, { action: 'insert', table, recordId: id, after: await db.get(table, id) });
      return id;
    },

    async patch(...args: unknown[]) {
      const { table, id, rest } = resolve(args);
      refuseAppendOnly(table);
      const before = await db.get(table, id);
      await db.patch(table, id as never, rest[0] as never);
      if (UNAUDITED_TABLES.has(table)) return;
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
      if (UNAUDITED_TABLES.has(table)) return;
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
      if (UNAUDITED_TABLES.has(table)) return;
      await appendAuditEntry(db, actor, { action: 'delete', table, recordId: id, before });
    },
  };

  return writer as unknown as DatabaseWriter;
}
