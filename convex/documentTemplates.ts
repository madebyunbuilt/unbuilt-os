import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx } from './_generated/server';
import { clauseByKey } from './clauses';
import { text } from './lib/crm';
import {
  assertKnownVariables,
  blockValidator,
  type DocumentBlock,
  documentError,
  documentType,
  type DocumentType,
  LEGAL_REVIEW_TYPES,
  PRICED_TYPES,
  variablesInBlocks,
} from './lib/documentBlocks';
import { teamMutation, teamQuery } from './lib/functions';

// Document templates (07-documents-and-esign.md). A template is ordered blocks; editing one makes a new version, and
// documents keep the version they were made from. Templates for the legal types stay flagged until a lawyer approves
// their wording, which the settings toggle records.

type Ctx = QueryCtx | MutationCtx;

const templateView = (template: Doc<'documentTemplates'>) => ({
  id: template._id,
  type: template.type,
  name: template.name,
  description: template.description,
  version: template.version,
  blocks: template.blocks,
  variables: template.variables,
  isDefault: template.isDefault,
  requiresLegalReview: template.requiresLegalReview,
  active: template.active,
});

/** Blocks are refused when they name a variable the app cannot fill in, or a clause that does not exist. */
async function checkedBlocks(ctx: Ctx, blocks: DocumentBlock[], type: DocumentType, name: string) {
  if (blocks.length === 0) throw documentError('documents.invalid', 'A template needs at least one block');
  for (const block of blocks) {
    if (block.kind === 'heading' || block.kind === 'paragraph') {
      assertKnownVariables(block.text, `The template "${name}"`);
    }
    if (block.kind === 'clause') {
      const clause = await clauseByKey(ctx, block.clauseKey);
      if (!clause) throw documentError('documents.clauseMissing', `There is no clause called "${block.clauseKey}"`);
      if (!clause.active) throw documentError('documents.clauseRetired', `The clause "${clause.title}" is retired`);
    }
  }
  if (PRICED_TYPES.has(type) && !blocks.some((block) => block.kind === 'totals')) {
    throw documentError('documents.invalid', 'A priced document needs a totals block, so the client sees the amount');
  }
  return blocks;
}

export const list = teamQuery('documents.view')({
  args: { type: v.optional(documentType), includeRetired: v.optional(v.boolean()) },
  handler: async (ctx, { type, includeRetired = false }) => {
    const templates = type
      ? await ctx.db
          .query('documentTemplates')
          .withIndex('by_type', (q) => q.eq('type', type))
          .collect()
      : await ctx.db.query('documentTemplates').collect();
    return templates
      .filter((template) => includeRetired || template.active)
      .map(templateView)
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  },
});

export const get = teamQuery('documents.view')({
  args: { templateId: v.id('documentTemplates') },
  handler: async (ctx, { templateId }) => {
    const template = await ctx.db.get('documentTemplates', templateId);
    return template ? templateView(template) : null;
  },
});

/** The template a new document of this type starts from. */
export async function defaultTemplateFor(ctx: Ctx, type: DocumentType): Promise<Doc<'documentTemplates'> | null> {
  const templates = await ctx.db
    .query('documentTemplates')
    .withIndex('by_type', (q) => q.eq('type', type))
    .collect();
  const active = templates.filter((template) => template.active);
  return active.find((template) => template.isDefault) ?? active[0] ?? null;
}

async function clearOtherDefaults(ctx: MutationCtx, type: DocumentType, keep: Id<'documentTemplates'>) {
  const templates = await ctx.db
    .query('documentTemplates')
    .withIndex('by_type', (q) => q.eq('type', type))
    .collect();
  for (const template of templates) {
    if (template._id !== keep && template.isDefault) {
      await ctx.db.patch('documentTemplates', template._id, { isDefault: false });
    }
  }
}

const fields = {
  name: v.string(),
  description: v.optional(v.string()),
  blocks: v.array(blockValidator),
};

export const create = teamMutation('templates.documents.manage')({
  args: { type: documentType, isDefault: v.optional(v.boolean()), ...fields },
  handler: async (ctx, args) => {
    const name = text(args.name, 'Name', { required: true, max: 120 })!;
    const blocks = await checkedBlocks(ctx, args.blocks, args.type, name);
    const templateId = await ctx.db.insert('documentTemplates', {
      type: args.type,
      name,
      description: text(args.description, 'Description', { max: 2000 }),
      version: 1,
      blocks,
      variables: variablesInBlocks(blocks),
      isDefault: args.isDefault ?? (await defaultTemplateFor(ctx, args.type)) === null,
      requiresLegalReview: LEGAL_REVIEW_TYPES.has(args.type),
      active: true,
    });
    if (args.isDefault) await clearOtherDefaults(ctx, args.type, templateId);
    return templateId;
  },
});

/** Editing the blocks makes a new version. Documents already made keep the version they were made from. */
export const update = teamMutation('templates.documents.manage')({
  args: { templateId: v.id('documentTemplates'), ...fields },
  handler: async (ctx, { templateId, ...args }) => {
    const template = await ctx.db.get('documentTemplates', templateId);
    if (!template) throw documentError('documents.notFound', 'Template not found');
    const name = text(args.name, 'Name', { required: true, max: 120 })!;
    const blocks = await checkedBlocks(ctx, args.blocks, template.type, name);
    const changed = JSON.stringify(blocks) !== JSON.stringify(template.blocks);
    const version = changed ? template.version + 1 : template.version;
    await ctx.db.patch('documentTemplates', templateId, {
      name,
      description: text(args.description, 'Description', { max: 2000 }),
      blocks,
      variables: variablesInBlocks(blocks),
      version,
    });
    return { version };
  },
});

export const setDefault = teamMutation('templates.documents.manage')({
  args: { templateId: v.id('documentTemplates') },
  handler: async (ctx, { templateId }) => {
    const template = await ctx.db.get('documentTemplates', templateId);
    if (!template) throw documentError('documents.notFound', 'Template not found');
    if (!template.active) throw documentError('documents.retired', 'Bring the template back before making it default');
    await ctx.db.patch('documentTemplates', templateId, { isDefault: true });
    await clearOtherDefaults(ctx, template.type, templateId);
  },
});

/** Templates are retired, never deleted: documents made from one keep their own copy of the blocks. */
export const setActive = teamMutation('templates.documents.manage')({
  args: { templateId: v.id('documentTemplates'), active: v.boolean() },
  handler: async (ctx, { templateId, active }) => {
    const template = await ctx.db.get('documentTemplates', templateId);
    if (!template) throw documentError('documents.notFound', 'Template not found');
    await ctx.db.patch('documentTemplates', templateId, { active, isDefault: active && template.isDefault });
  },
});
