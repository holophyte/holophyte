import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireOrgMembership, requireRole } from './lib/auth';

export const listActive = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    // Use by_status index for O(1) lookup, then verify org membership
    const runningSessions = await ctx.db
      .query('sessions')
      .withIndex('by_status', (q) => q.eq('status', 'running'))
      .collect();
    const orgSessions = [];
    for (const session of runningSessions) {
      const task = await ctx.db.get(session.taskId);
      if (!task) continue;
      const repo = await ctx.db.get(task.repoId);
      if (!repo || repo.orgId !== args.orgId) continue;
      orgSessions.push(session);
    }
    return orgSessions;
  },
});

export const get = query({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) return null;
    const task = await ctx.db.get(session.taskId);
    if (!task) return null;
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return null;
    await requireOrgMembership(ctx, repo.orgId);
    return session;
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
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    const updates: Record<string, unknown> = { status: args.status };
    if (args.status !== 'running') {
      updates.endedAt = Date.now();
    }
    await ctx.db.patch(args.id, updates);
  },
});

/** Server-side mutation to persist the SDK session ID, model, and permission mode. */
export const updateSdkSessionId = internalMutation({
  args: {
    id: v.id('sessions'),
    sdkSessionId: v.string(),
    model: v.optional(v.string()),
    permissionMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const updates: Record<string, unknown> = {
      sdkSessionId: args.sdkSessionId,
    };
    if (args.model !== undefined) updates.model = args.model;
    if (args.permissionMode !== undefined)
      updates.permissionMode = args.permissionMode;
    await ctx.db.patch(args.id, updates);
  },
});

/** Server-side mutation to update session status. Called by the Bun server. */
export const serverUpdateStatus = internalMutation({
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
    const updates: Record<string, unknown> = { status: args.status };
    if (args.status !== 'running') {
      updates.endedAt = Date.now();
    }
    await ctx.db.patch(args.id, updates);
  },
});
