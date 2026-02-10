import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const list = query({
  args: { repoId: v.optional(v.id('repos')) },
  handler: async (ctx, args) => {
    // Get global templates
    const global = await ctx.db
      .query('promptTemplates')
      .withIndex('by_repo', (q) => q.eq('repoId', undefined))
      .collect();

    if (!args.repoId) return global;

    // Get repo-specific templates
    const repoTemplates = await ctx.db
      .query('promptTemplates')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();

    return [...repoTemplates, ...global];
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    content: v.string(),
    repoId: v.optional(v.id('repos')),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('promptTemplates', {
      name: args.name,
      content: args.content,
      repoId: args.repoId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('promptTemplates'),
    name: v.optional(v.string()),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.content !== undefined) updates.content = fields.content;
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id('promptTemplates') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
