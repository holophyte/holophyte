import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';

export const upsertHeartbeat = internalMutation({
  args: {
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('companion').first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        ...(args.machineId !== undefined && { machineId: args.machineId }),
      });
    } else {
      await ctx.db.insert('companion', {
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        machineId: args.machineId,
      });
    }
  },
});

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.query('companion').first();
  },
});
