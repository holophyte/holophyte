import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgMembership, requireRole } from './lib/auth';

export const listActive = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    // Query sessions through org repos → tasks to avoid reading global data
    const orgRepos = await ctx.db
      .query('repos')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();
    const orgSessions = [];
    for (const repo of orgRepos) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_repo_status', (q) => q.eq('repoId', repo._id))
        .collect();
      for (const task of tasks) {
        const sessions = await ctx.db
          .query('sessions')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .collect();
        for (const session of sessions) {
          if (session.status === 'running') {
            orgSessions.push(session);
          }
        }
      }
    }
    return orgSessions;
  },
});

export const getByTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return null;
    await requireOrgMembership(ctx, repo.orgId);
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();
    return sessions.length > 0 ? sessions[sessions.length - 1] : null;
  },
});

export const create = mutation({
  args: {
    taskId: v.id('tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    return await ctx.db.insert('sessions', {
      taskId: args.taskId,
      status: 'running',
      startedAt: Date.now(),
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id('sessions'),
    status: v.union(
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('stopped'),
    ),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const task = await ctx.db.get(session.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    await requireOrgMembership(ctx, repo.orgId);
    const updates: Record<string, unknown> = { status: args.status };
    if (args.status !== 'running') {
      updates.endedAt = Date.now();
    }
    await ctx.db.patch(args.id, updates);
  },
});
