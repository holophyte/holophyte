import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const listByTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('promptHistory')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .collect();
  },
});

export const record = mutation({
  args: {
    taskId: v.id('tasks'),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if latest entry is identical — skip duplicate
    const latest = await ctx.db
      .query('promptHistory')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .first();
    if (latest && latest.prompt === args.prompt) return;

    await ctx.db.insert('promptHistory', {
      taskId: args.taskId,
      prompt: args.prompt,
      createdAt: Date.now(),
    });
  },
});
