import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireOrgMembership, requireRole } from './lib/auth';

const sessionStatusValidator = v.union(
  v.literal('running'),
  v.literal('idle'),
  v.literal('failed'),
);

/**
 * Returns all currently running sessions scoped to an org.
 *
 * Uses the `by_status` index for an O(1) status scan, then cross-checks each
 * session's task→repo chain to filter by org. Requires org membership.
 */
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

/**
 * Returns the global count of currently running sessions (across all orgs).
 *
 * Used by the server to enforce the concurrent session cap before spawning a
 * new SDK process. No auth check — callers on the server trust this value.
 */
export const countActive = query({
  args: {},
  handler: async (ctx) => {
    const runningSessions = await ctx.db
      .query('sessions')
      .withIndex('by_status', (q) => q.eq('status', 'running'))
      .collect();
    return runningSessions.length;
  },
});

/**
 * Returns a single session by ID, or `null` if not found.
 * Verifies that the caller is a member of the session's parent org.
 */
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
      .withIndex('by_task_activity', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .first();
    return sessions ?? null;
  },
});

export const listByTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return [];
    await requireOrgMembership(ctx, repo.orgId);
    return await ctx.db
      .query('sessions')
      .withIndex('by_task_activity', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .collect();
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
    const now = Date.now();
    return await ctx.db.insert('sessions', {
      taskId: args.taskId,
      status: 'running',
      startedAt: now,
      lastActivityAt: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id('sessions'),
    status: sessionStatusValidator,
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
    await ctx.db.patch(args.id, {
      status: args.status,
      lastActivityAt: Date.now(),
    });
  },
});

export const updateLastActivity = mutation({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const task = await ctx.db.get(session.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    await requireOrgMembership(ctx, repo.orgId);
    await ctx.db.patch(args.id, { lastActivityAt: Date.now() });
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
    status: sessionStatusValidator,
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    await ctx.db.patch(args.id, {
      status: args.status,
      lastActivityAt: Date.now(),
    });
  },
});

/** Server-side mutation to update lastActivityAt. Called by the Bun server during active sessions. */
export const serverUpdateActivity = internalMutation({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    await ctx.db.patch(args.id, { lastActivityAt: Date.now() });
  },
});

/** Server-side mutation to update the session name. */
export const serverUpdateName = internalMutation({
  args: {
    id: v.id('sessions'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    await ctx.db.patch(args.id, { name: args.name });
  },
});
