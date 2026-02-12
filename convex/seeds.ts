import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgMembership, requireRole } from './lib/auth';
import { TaskStatus } from './schema';

export const list = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    return await ctx.db
      .query('seeds')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    orgId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireOrgMembership(ctx, args.orgId);
    requireRole(membership, 'member');
    return await ctx.db.insert('seeds', {
      title: args.title,
      description: args.description ?? '',
      status: 'active',
      createdAt: Date.now(),
      orgId: args.orgId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('seeds'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const seed = await ctx.db.get(args.id);
    if (!seed) throw new Error('Seed not found');
    const { membership } = await requireOrgMembership(ctx, seed.orgId);
    requireRole(membership, 'member');
    const { id, ...fields } = args;
    const updates: Record<string, string> = {};
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== undefined)
      updates.description = fields.description;
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id('seeds') },
  handler: async (ctx, args) => {
    const seed = await ctx.db.get(args.id);
    if (!seed) throw new Error('Seed not found');
    const { membership } = await requireOrgMembership(ctx, seed.orgId);
    requireRole(membership, 'member');
    await ctx.db.delete(args.id);
  },
});

export const plant = mutation({
  args: {
    id: v.id('seeds'),
    repoId: v.id('repos'),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const seed = await ctx.db.get(args.id);
    if (!seed) throw new Error('Seed not found');
    const repo = await ctx.db.get(args.repoId);
    if (!repo) throw new Error('Repo not found');
    if (seed.orgId !== repo.orgId) {
      throw new Error('Seed and repo must belong to the same organization');
    }
    const { userId, membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');

    // Calculate position for new task in backlog
    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) =>
        q.eq('repoId', args.repoId).eq('status', TaskStatus.Backlog),
      )
      .collect();
    const maxPosition = existing.reduce(
      (max, t) => Math.max(max, t.position),
      0,
    );

    const now = Date.now();
    const taskId = await ctx.db.insert('tasks', {
      repoId: args.repoId,
      title: seed.title,
      description: seed.description,
      prompt: args.prompt ?? '',
      status: TaskStatus.Backlog,
      position: maxPosition + 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });

    await ctx.db.patch(args.id, {
      status: 'planted',
      plantedToTaskId: taskId,
    });

    return taskId;
  },
});
