import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgMembership } from './lib/auth';

export const listByTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return [];
    await requireOrgMembership(ctx, repo.orgId);
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
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    await requireOrgMembership(ctx, repo.orgId);
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
