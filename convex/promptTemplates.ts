import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireAuth, requireOrgMembership, requireRole } from './lib/auth';

export const list = query({
  args: { repoId: v.optional(v.id('repos')) },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    // Convex indexes include docs with undefined optional fields,
    // so eq('repoId', undefined) matches global templates.
    const global = await ctx.db
      .query('promptTemplates')
      .withIndex('by_repo', (q) => q.eq('repoId', undefined))
      .collect();
    const userGlobal = global.filter((t) => t.userId === userId);
    if (!args.repoId) return userGlobal;
    // Verify org access through repo
    const repo = await ctx.db.get(args.repoId);
    if (!repo) return userGlobal;
    await requireOrgMembership(ctx, repo.orgId);
    const repoTemplates = await ctx.db
      .query('promptTemplates')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect();
    const userRepoTemplates = repoTemplates.filter((t) => t.userId === userId);
    return [...userRepoTemplates, ...userGlobal];
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    content: v.string(),
    repoId: v.optional(v.id('repos')),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    if (args.repoId) {
      const repo = await ctx.db.get(args.repoId);
      if (!repo) throw new Error('Repo not found');
      const { membership } = await requireOrgMembership(ctx, repo.orgId);
      requireRole(membership, 'member');
    }
    const now = Date.now();
    return await ctx.db.insert('promptTemplates', {
      name: args.name,
      content: args.content,
      repoId: args.repoId,
      createdAt: now,
      updatedAt: now,
      userId,
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
    const userId = await requireAuth(ctx);
    const template = await ctx.db.get(args.id);
    if (!template) throw new Error('Template not found');
    if (template.userId !== userId) {
      throw new Error("Cannot edit another user's template");
    }
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
    const userId = await requireAuth(ctx);
    const template = await ctx.db.get(args.id);
    if (!template) throw new Error('Template not found');
    if (template.userId !== userId) {
      throw new Error("Cannot delete another user's template");
    }
    await ctx.db.delete(args.id);
  },
});
