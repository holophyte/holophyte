import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import { requireOrgMembership } from './lib/auth';

const LOCALHOST_URL_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

export const upsertHeartbeat = internalMutation({
  args: {
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
    url: v.optional(v.string()),
    orgId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    if (args.url != null && !LOCALHOST_URL_RE.test(args.url)) {
      throw new Error(
        `Companion URL must be http://localhost:<port> or http://127.0.0.1:<port>, got: ${args.url}`,
      );
    }

    // Upsert by (orgId, machineId) so multiple companions can coexist across orgs
    const existing = args.machineId
      ? await ctx.db
          .query('companion')
          .withIndex('by_org_machine', (q) =>
            q.eq('orgId', args.orgId).eq('machineId', args.machineId),
          )
          .first()
      : await ctx.db
          .query('companion')
          .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
          .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        ...(args.machineId !== undefined && { machineId: args.machineId }),
        ...(args.url !== undefined && { url: args.url }),
      });
    } else {
      await ctx.db.insert('companion', {
        orgId: args.orgId,
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        machineId: args.machineId,
        url: args.url,
      });
    }
  },
});

export const getLastSeen = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('companion')
      .withIndex('by_org_last_seen', (q) => q.eq('orgId', args.orgId))
      .order('desc')
      .first();
    return record
      ? { lastSeen: record.lastSeen, machineId: record.machineId }
      : null;
  },
});

export const getStatus = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    return await ctx.db
      .query('companion')
      .withIndex('by_org_last_seen', (q) => q.eq('orgId', args.orgId))
      .order('desc')
      .first();
  },
});
