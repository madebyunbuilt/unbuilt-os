import { ConvexError } from 'convex/values';
import { type MutationCtx } from '../_generated/server';

// Human-readable numbers from `counters` (04-data-model.md, Numbering). Call nextNumber inside the mutation that sends
// or issues the record: Convex runs that mutation as one serializable transaction, so numbers never repeat or skip.

export const DEFAULT_NUMBERING = {
  invoice: { prefix: 'UNB-INV-', padding: 4 },
  quote: { prefix: 'UNB-QUO-', padding: 4 },
  proposal: { prefix: 'UNB-PRO-', padding: 4 },
  sow: { prefix: 'UNB-SOW-', padding: 4 },
  contract: { prefix: 'UNB-CON-', padding: 4 },
  sla: { prefix: 'UNB-SLA-', padding: 4 },
  changeRequest: { prefix: 'UNB-CR-', padding: 4 },
  creditNote: { prefix: 'UNB-CN-', padding: 4 },
  receipt: { prefix: 'UNB-RCT-', padding: 4 },
  ticket: { prefix: 'UNB-TKT-', padding: 4 },
  project: { prefix: 'UNB-P-', padding: 4 },
} as const satisfies Record<string, NumberFormat>;

export type NumberedRecord = keyof typeof DEFAULT_NUMBERING;

export type NumberFormat = { prefix: string; padding: number };

/** Zero-pads to `padding` digits; larger values keep every digit. */
export function formatNumber(value: number, { prefix, padding }: NumberFormat): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new ConvexError(`Invalid record number ${value}`);
  return `${prefix}${String(value).padStart(padding, '0')}`;
}

async function counterFor(ctx: MutationCtx, record: NumberedRecord) {
  return await ctx.db
    .query('counters')
    .withIndex('by_key', (q) => q.eq('key', record))
    .unique();
}

/** Increments the counter for `record` and returns the formatted number. Counters never reset. */
export async function nextNumber(
  ctx: MutationCtx,
  record: NumberedRecord,
  format: NumberFormat = DEFAULT_NUMBERING[record],
): Promise<string> {
  const counter = await counterFor(ctx, record);
  const value = (counter?.value ?? 0) + 1;
  if (counter) {
    await ctx.db.patch(counter._id, { value });
  } else {
    await ctx.db.insert('counters', { key: record, value });
  }
  return formatNumber(value, format);
}

/** Raises a counter to at least `value`, so imported records keep their numbers and new ones never collide. */
export async function ensureCounterAtLeast(ctx: MutationCtx, record: NumberedRecord, value: number): Promise<void> {
  if (!Number.isSafeInteger(value) || value < 0) throw new ConvexError(`Invalid counter value ${value}`);
  const counter = await counterFor(ctx, record);
  if (!counter) {
    await ctx.db.insert('counters', { key: record, value });
  } else if (counter.value < value) {
    await ctx.db.patch(counter._id, { value });
  }
}
