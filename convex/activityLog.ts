import type { Infer } from 'convex/values';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { query } from './_generated/server';
import { requireOrgMembership } from './lib/auth';
import type { activityActionValidator } from './schema';

type ActivityAction = Infer<typeof activityActionValidator>;

export async function logActivity(
  ctx: MutationCtx,
  args: {
    orgId: Id<'organizations'>;
    userId: Id<'users'>;
    action: ActivityAction;
    entityType: 'task' | 'seed' | 'label' | 'repo';
    entityId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await ctx.db.insert('activityLog', {
    orgId: args.orgId,
    userId: args.userId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
    createdAt: Date.now(),
  });
}

export const list = query({
  args: {
    orgId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    const limit = args.limit ?? 50;
    const entries = await ctx.db
      .query('activityLog')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .order('desc')
      .take(limit);

    // Join user names
    const userIds = [...new Set(entries.map((e) => e.userId))];
    const userMap = new Map<string, string>();
    for (const uid of userIds) {
      const user = await ctx.db.get(uid);
      if (user) userMap.set(uid, user.name ?? 'Unknown');
    }

    return entries.map((e) => ({
      ...e,
      userName: userMap.get(e.userId) ?? 'Unknown',
    }));
  },
});

export const listByEntity = query({
  args: {
    entityType: v.union(
      v.literal('task'),
      v.literal('seed'),
      v.literal('label'),
      v.literal('repo'),
    ),
    entityId: v.string(),
    orgId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    const limit = args.limit ?? 50;
    const entries = await ctx.db
      .query('activityLog')
      .withIndex('by_entity', (q) =>
        q.eq('entityType', args.entityType).eq('entityId', args.entityId),
      )
      .order('desc')
      .take(limit);

    const userIds = [...new Set(entries.map((e) => e.userId))];
    const userMap = new Map<string, string>();
    for (const uid of userIds) {
      const user = await ctx.db.get(uid);
      if (user) userMap.set(uid, user.name ?? 'Unknown');
    }

    return entries.map((e) => ({
      ...e,
      userName: userMap.get(e.userId) ?? 'Unknown',
    }));
  },
});
