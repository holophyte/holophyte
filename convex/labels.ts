import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgMembership, requireRole } from './lib/auth';

export const list = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMembership(ctx, args.orgId);
    const orgLabels = await ctx.db
      .query('labels')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();
    // Return shared labels (no userId) + current user's personal labels
    return orgLabels.filter((l) => !l.userId || l.userId === userId);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    orgId: v.id('organizations'),
    personal: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireOrgMembership(ctx, args.orgId);
    requireRole(membership, 'member');
    return await ctx.db.insert('labels', {
      name: args.name,
      color: args.color,
      createdAt: Date.now(),
      orgId: args.orgId,
      userId: args.personal ? userId : undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('labels'),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const label = await ctx.db.get(args.id);
    if (!label) throw new Error('Label not found');
    const { membership } = await requireOrgMembership(ctx, label.orgId);
    requireRole(membership, 'member');
    const { id, ...fields } = args;
    const updates: Record<string, string> = {};
    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.color !== undefined) updates.color = fields.color;
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id('labels') },
  handler: async (ctx, args) => {
    const label = await ctx.db.get(args.id);
    if (!label) throw new Error('Label not found');
    const { membership } = await requireOrgMembership(ctx, label.orgId);
    requireRole(membership, 'admin');
    // Remove label reference from tasks within this org's repos only
    const orgRepos = await ctx.db
      .query('repos')
      .withIndex('by_org', (q) => q.eq('orgId', label.orgId))
      .collect();
    for (const repo of orgRepos) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_repo_status', (q) => q.eq('repoId', repo._id))
        .collect();
      for (const task of tasks) {
        const labelIds = task.labelIds ?? [];
        if (labelIds.includes(args.id)) {
          await ctx.db.patch(task._id, {
            labelIds: labelIds.filter((lid) => lid !== args.id),
          });
        }
      }
    }
    await ctx.db.delete(args.id);
  },
});
