import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const listByTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query('promptHistory')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();
    // Most recent first
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const record = mutation({
  args: {
    taskId: v.id('tasks'),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.prompt.trim()) return;

    // Check if latest entry is identical — skip duplicate
    const existing = await ctx.db
      .query('promptHistory')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();
    const latest = existing.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest && latest.prompt === args.prompt) return;

    await ctx.db.insert('promptHistory', {
      taskId: args.taskId,
      prompt: args.prompt,
      createdAt: Date.now(),
    });
  },
});
