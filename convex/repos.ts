import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('repos').collect();
  },
});

export const get = query({
  args: { id: v.id('repos') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('repos')
      .withIndex('by_path', (q) => q.eq('path', args.path))
      .first();
    if (existing) {
      throw new Error(`Repo already exists at ${args.path}`);
    }
    return await ctx.db.insert('repos', {
      name: args.name,
      path: args.path,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('repos'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name });
  },
});

export const remove = mutation({
  args: { id: v.id('repos') },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) => q.eq('repoId', args.id))
      .collect();
    for (const task of tasks) {
      const sessions = await ctx.db
        .query('sessions')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .collect();
      for (const session of sessions) {
        await ctx.db.delete(session._id);
      }
      await ctx.db.delete(task._id);
    }
    await ctx.db.delete(args.id);
  },
});
