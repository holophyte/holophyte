import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import {
  getUserOrgIds,
  getUserWritableOrgIds,
  requireAuth,
  requireOrgMembership,
} from './lib/auth';

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
    const existing = await ctx.db
      .query('companion')
      .withIndex('by_org_machine', (q) =>
        q.eq('orgId', args.orgId).eq('machineId', args.machineId),
      )
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

// ── Shared helper ────────────────────────────────────────────────────

async function upsertHeartbeatForOrgs(
  ctx: MutationCtx,
  orgIds: Id<'organizations'>[],
  args: {
    activeSessionCount: number;
    machineId?: string;
    url?: string;
  },
) {
  if (args.url != null && !LOCALHOST_URL_RE.test(args.url)) {
    throw new Error(
      `Companion URL must be http://localhost:<port> or http://127.0.0.1:<port>, got: ${args.url}`,
    );
  }

  for (const orgId of orgIds) {
    const existing = await ctx.db
      .query('companion')
      .withIndex('by_org_machine', (q) =>
        q.eq('orgId', orgId).eq('machineId', args.machineId),
      )
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
        orgId,
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        machineId: args.machineId,
        url: args.url,
      });
    }
  }
}

// ── Public companion mutations (JWT-authenticated via ConvexClient) ──

/**
 * Upserts a companion heartbeat for the authenticated user's orgs.
 */
export const companionHeartbeat = mutation({
  args: {
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserWritableOrgIds(ctx, userId);
    await upsertHeartbeatForOrgs(ctx, [...orgIds], args);
  },
});

/**
 * Returns the most recent companion heartbeat across all of the user's orgs.
 * Public equivalent of the `/api/internal/companion/status` HTTP endpoint.
 *
 * Checks every org the user belongs to and returns the most recently seen
 * heartbeat, so the duplicate-instance check works correctly for multi-org users.
 */
export const companionGetStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserOrgIds(ctx, userId);
    if (orgIds.size === 0) return null;

    let latest: { lastSeen: number; machineId?: string } | null = null;
    for (const orgId of orgIds) {
      const record = await ctx.db
        .query('companion')
        .withIndex('by_org_last_seen', (q) => q.eq('orgId', orgId))
        .order('desc')
        .first();
      if (record && (!latest || record.lastSeen > latest.lastSeen)) {
        latest = { lastSeen: record.lastSeen, machineId: record.machineId };
      }
    }
    return latest;
  },
});
