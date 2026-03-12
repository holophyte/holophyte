import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';

export const upsertHeartbeat = internalMutation({
  args: {
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('companion').first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        ...(args.machineId !== undefined && { machineId: args.machineId }),
        ...(args.url !== undefined && { url: args.url }),
      });
    } else {
      await ctx.db.insert('companion', {
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        machineId: args.machineId,
        url: args.url,
      });
    }
  },
});

export const getLastSeen = internalQuery({
  args: {},
  handler: async (ctx) => {
    const record = await ctx.db.query('companion').first();
    return record
      ? { lastSeen: record.lastSeen, machineId: record.machineId }
      : null;
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
