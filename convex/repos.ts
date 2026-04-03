import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { requireOrgMembership, requireRole } from './lib/auth';
import { sortPreferenceValidator } from './schema';

export const list = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    return await ctx.db
      .query('repos')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id('repos') },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.id);
    if (!repo) return null;
    await requireOrgMembership(ctx, repo.orgId);
    return repo;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    path: v.string(),
    orgId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireOrgMembership(ctx, args.orgId);
    requireRole(membership, 'member');
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
      orgId: args.orgId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('repos'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.id);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    await ctx.db.patch(args.id, { name: args.name });
  },
});

export const updateSortPreference = mutation({
  args: {
    id: v.id('repos'),
    sortPreference: sortPreferenceValidator,
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.id);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    await ctx.db.patch(args.id, {
      sortPreference: args.sortPreference,
      // Clear stale AI sort order when switching away from auto
      ...(args.sortPreference !== 'auto' && { sortOrder: undefined }),
    });
  },
});

export const verifyRepoAccess = internalQuery({
  args: { repoId: v.id('repos'), userId: v.id('users') },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) throw new Error('Repo not found');
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_user_org', (q) =>
        q.eq('userId', args.userId).eq('orgId', repo.orgId),
      )
      .first();
    if (!membership) throw new Error('Not a member of this organization');
    return repo;
  },
});

export const updateSortOrder = internalMutation({
  args: {
    id: v.id('repos'),
    sortOrder: v.array(v.id('tasks')),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { sortOrder: args.sortOrder });
  },
});

export const remove = mutation({
  args: { id: v.id('repos') },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.id);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'admin');
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) => q.eq('repoId', args.id))
      .collect();
    for (const task of tasks) {
      const sessions = await ctx.db
        .query('sessions')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .collect();
      for (const session of sessions) await ctx.db.delete(session._id);
      const subtasks = await ctx.db
        .query('subtasks')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .collect();
      for (const subtask of subtasks) await ctx.db.delete(subtask._id);
      const history = await ctx.db
        .query('promptHistory')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .collect();
      for (const entry of history) await ctx.db.delete(entry._id);
      await ctx.db.delete(task._id);
    }
    const templates = await ctx.db
      .query('promptTemplates')
      .withIndex('by_repo', (q) => q.eq('repoId', args.id))
      .collect();
    for (const tmpl of templates) await ctx.db.delete(tmpl._id);
    await ctx.db.delete(args.id);
  },
});
