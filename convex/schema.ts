import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Field contract: docs/spec/04-data-model.md. Tables arrive with the pull requests that use them.
export default defineSchema({
  counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index('by_key', ['key']),
});
