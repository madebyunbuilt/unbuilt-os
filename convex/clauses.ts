import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { text } from './lib/crm';
import { assertKnownVariables, documentError } from './lib/documentBlocks';
import { teamMutation, teamQuery } from './lib/functions';

// Clauses (07-documents-and-esign.md, Templates and clauses). Each clause has a key templates refer to and a version
// that goes up whenever its wording changes. A document copies the wording in at creation, so editing a clause here
// never changes a document that already exists.

type Ctx = QueryCtx | MutationCtx;

const clauseView = (clause: Doc<'clauses'>) => ({
  id: clause._id,
  key: clause.key,
  title: clause.title,
  body: clause.body,
  category: clause.category,
  version: clause.version,
  active: clause.active,
});

export async function clauseByKey(ctx: Ctx, key: string): Promise<Doc<'clauses'> | null> {
  return await ctx.db
    .query('clauses')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
}

/** The clause as it stands now, for copying into a document. */
export async function currentClause(ctx: Ctx, key: string) {
  const clause = await clauseByKey(ctx, key);
  if (!clause) throw documentError('documents.clauseMissing', `There is no clause called "${key}"`);
  return clause;
}

export const list = teamQuery('documents.view')({
  args: { includeRetired: v.optional(v.boolean()) },
  handler: async (ctx, { includeRetired = false }) => {
    const clauses = await ctx.db.query('clauses').collect();
    return clauses
      .filter((clause) => includeRetired || clause.active)
      .map(clauseView)
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  },
});

const KEY_PATTERN = /^[a-z][a-z0-9-]{1,59}$/;

function checkedKey(key: string) {
  const cleaned = key.trim().toLowerCase();
  if (!KEY_PATTERN.test(cleaned)) {
    throw documentError(
      'documents.invalid',
      'A clause key is lowercase letters, numbers and hyphens, such as "payment-terms"',
    );
  }
  return cleaned;
}

function checkedBody(body: string, title: string) {
  const cleaned = text(body, 'The clause', { required: true, max: 20_000 })!;
  assertKnownVariables(cleaned, `The clause "${title}"`);
  return cleaned;
}

export const create = teamMutation('templates.documents.manage')({
  args: { key: v.string(), title: v.string(), body: v.string(), category: v.string() },
  handler: async (ctx, args) => {
    const key = checkedKey(args.key);
    if (await clauseByKey(ctx, key)) throw documentError('documents.clauseExists', `"${key}" is already in use`);
    const title = text(args.title, 'Title', { required: true, max: 120 })!;
    return await ctx.db.insert('clauses', {
      key,
      title,
      body: checkedBody(args.body, title),
      category: text(args.category, 'Category', { required: true, max: 60 })!,
      version: 1,
      active: true,
    });
  },
});

/** Changing the wording makes a new version. Templates keep pointing at the key and pick up the new wording next time. */
export const update = teamMutation('templates.documents.manage')({
  args: { clauseId: v.id('clauses'), title: v.string(), body: v.string(), category: v.string() },
  handler: async (ctx, { clauseId, ...args }) => {
    const clause = await ctx.db.get('clauses', clauseId);
    if (!clause) throw documentError('documents.notFound', 'Clause not found');
    const title = text(args.title, 'Title', { required: true, max: 120 })!;
    const body = checkedBody(args.body, title);
    const changed = body !== clause.body;
    await ctx.db.patch('clauses', clauseId, {
      title,
      body,
      category: text(args.category, 'Category', { required: true, max: 60 })!,
      version: changed ? clause.version + 1 : clause.version,
    });
    return { version: changed ? clause.version + 1 : clause.version };
  },
});

/** Clauses are retired, never deleted: documents that used one keep their copy of the wording. */
export const setActive = teamMutation('templates.documents.manage')({
  args: { clauseId: v.id('clauses'), active: v.boolean() },
  handler: async (ctx, { clauseId, active }) => {
    const clause = await ctx.db.get('clauses', clauseId);
    if (!clause) throw documentError('documents.notFound', 'Clause not found');
    if (!active) await assertUnusedByActiveTemplates(ctx, clause.key);
    await ctx.db.patch('clauses', clauseId, { active });
  },
});

/** A clause an active template still names cannot be retired: the template would no longer render. */
async function assertUnusedByActiveTemplates(ctx: MutationCtx, key: string) {
  const templates = await ctx.db.query('documentTemplates').collect();
  const used = templates.filter(
    (template) => template.active && template.blocks.some((b) => b.kind === 'clause' && b.clauseKey === key),
  );
  if (used.length > 0) {
    throw documentError(
      'documents.clauseInUse',
      `${used.map((template) => template.name).join(', ')} still use this clause`,
    );
  }
}

export const get = teamQuery('documents.view')({
  args: { clauseId: v.id('clauses') },
  handler: async (ctx, { clauseId }) => {
    const clause = await ctx.db.get('clauses', clauseId as Id<'clauses'>);
    return clause ? clauseView(clause) : null;
  },
});
