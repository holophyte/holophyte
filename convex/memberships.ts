import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireAuth, requireOrgMembership, requireRole } from './lib/auth';
import { roleValidator } from './schema';

export const listByOrg = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();
    return Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { ...m, user };
      }),
    );
  },
});

export const invite = mutation({
  args: {
    orgId: v.id('organizations'),
    userId: v.id('users'),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const { membership } = await requireOrgMembership(ctx, args.orgId);
    requireRole(membership, 'admin');
    if (args.role === 'owner' && membership.role !== 'owner') {
      throw new Error('Only owners can assign the owner role');
    }
    const existing = await ctx.db
      .query('memberships')
      .withIndex('by_user_org', (q) =>
        q.eq('userId', args.userId).eq('orgId', args.orgId),
      )
      .first();
    if (existing) throw new Error('User is already a member');
    return await ctx.db.insert('memberships', {
      userId: args.userId,
      orgId: args.orgId,
      role: args.role,
    });
  },
});

export const updateRole = mutation({
  args: {
    id: v.id('memberships'),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.id);
    if (!target) throw new Error('Membership not found');
    const { membership } = await requireOrgMembership(ctx, target.orgId);
    requireRole(membership, 'admin');
    if (target.role === 'owner') {
      throw new Error('Cannot change the role of an owner');
    }
    if (args.role === 'owner' && membership.role !== 'owner') {
      throw new Error('Only owners can promote to owner');
    }
    await ctx.db.patch(args.id, { role: args.role });
  },
});

export const remove = mutation({
  args: { id: v.id('memberships') },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.id);
    if (!target) throw new Error('Membership not found');
    const { membership } = await requireOrgMembership(ctx, target.orgId);
    requireRole(membership, 'admin');
    if (target.role === 'owner') {
      throw new Error('Cannot remove an owner');
    }
    await ctx.db.delete(args.id);
  },
});

export const leave = mutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_user_org', (q) =>
        q.eq('userId', userId).eq('orgId', args.orgId),
      )
      .first();
    if (!membership) throw new Error('Not a member of this organization');
    if (membership.role === 'owner') {
      // Check if there are other owners
      const orgMembers = await ctx.db
        .query('memberships')
        .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
        .collect();
      const otherOwners = orgMembers.filter(
        (m) => m.role === 'owner' && m.userId !== userId,
      );
      if (otherOwners.length === 0) {
        throw new Error(
          'Cannot leave: you are the only owner. Transfer ownership first.',
        );
      }
    }
    await ctx.db.delete(membership._id);
  },
});
