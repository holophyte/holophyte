import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
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
    instanceId: v.string(),
    url: v.optional(v.string()),
    orgId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    if (args.url != null && !LOCALHOST_URL_RE.test(args.url)) {
      throw new Error(
        `Companion URL must be http://localhost:<port> or http://127.0.0.1:<port>, got: ${args.url}`,
      );
    }

    // Upsert by (orgId, instanceId) so each process gets its own row
    const existing = await ctx.db
      .query('companion')
      .withIndex('by_org_instance', (q) =>
        q.eq('orgId', args.orgId).eq('instanceId', args.instanceId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        ...(args.machineId !== undefined && { machineId: args.machineId }),
        ...(args.instanceId !== undefined && { instanceId: args.instanceId }),
        ...(args.url !== undefined && { url: args.url }),
      });
    } else {
      await ctx.db.insert('companion', {
        orgId: args.orgId,
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        machineId: args.machineId,
        instanceId: args.instanceId,
        url: args.url,
      });
    }
  },
});

/**
 * Upsert a companion heartbeat for every org in the deployment.
 * The companion serves the entire deployment, so all orgs should see it.
 */
export const upsertHeartbeatAllOrgs = internalMutation({
  args: {
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
    instanceId: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.url != null && !LOCALHOST_URL_RE.test(args.url)) {
      throw new Error(
        `Companion URL must be http://localhost:<port> or http://127.0.0.1:<port>, got: ${args.url}`,
      );
    }

    const orgs = await ctx.db.query('organizations').collect();
    for (const org of orgs) {
      const existing = await ctx.db
        .query('companion')
        .withIndex('by_org_instance', (q) =>
          q.eq('orgId', org._id).eq('instanceId', args.instanceId),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          lastSeen: Date.now(),
          activeSessionCount: args.activeSessionCount,
          ...(args.machineId !== undefined && { machineId: args.machineId }),
          ...(args.instanceId !== undefined && { instanceId: args.instanceId }),
          ...(args.url !== undefined && { url: args.url }),
        });
      } else {
        await ctx.db.insert('companion', {
          orgId: org._id,
          lastSeen: Date.now(),
          activeSessionCount: args.activeSessionCount,
          machineId: args.machineId,
          instanceId: args.instanceId,
          url: args.url,
        });
      }
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
      ? {
          lastSeen: record.lastSeen,
          machineId: record.machineId,
          instanceId: record.instanceId,
        }
      : null;
  },
});

export const getStatus = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    const record = await ctx.db
      .query('companion')
      .withIndex('by_org_last_seen', (q) => q.eq('orgId', args.orgId))
      .order('desc')
      .first();
    if (!record) return null;
    return {
      lastSeen: record.lastSeen,
      activeSessionCount: record.activeSessionCount,
      machineId: record.machineId,
      url: record.url,
    };
  },
});

// ── Shared helper ────────────────────────────────────────────────────

async function upsertHeartbeatForOrgs(
  ctx: MutationCtx,
  orgIds: Id<'organizations'>[],
  args: {
    activeSessionCount: number;
    machineId?: string;
    instanceId: string;
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
      .withIndex('by_org_instance', (q) =>
        q.eq('orgId', orgId).eq('instanceId', args.instanceId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        ...(args.machineId !== undefined && { machineId: args.machineId }),
        ...(args.instanceId !== undefined && { instanceId: args.instanceId }),
        ...(args.url !== undefined && { url: args.url }),
      });
    } else {
      await ctx.db.insert('companion', {
        orgId,
        lastSeen: Date.now(),
        activeSessionCount: args.activeSessionCount,
        machineId: args.machineId,
        instanceId: args.instanceId,
        url: args.url,
      });
    }
  }
}

// ── Public companion mutations (JWT-authenticated via ConvexClient) ──

/**
 * Upserts a companion heartbeat for the authenticated user's orgs.
 * Public equivalent of {@link upsertHeartbeatAllOrgs} — scoped to user's orgs.
 */
export const companionHeartbeat = mutation({
  args: {
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
    instanceId: v.string(),
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

    let latest: {
      lastSeen: number;
      machineId?: string;
      instanceId?: string;
    } | null = null;
    for (const orgId of orgIds) {
      const record = await ctx.db
        .query('companion')
        .withIndex('by_org_last_seen', (q) => q.eq('orgId', orgId))
        .order('desc')
        .first();
      if (record && (!latest || record.lastSeen > latest.lastSeen)) {
        latest = {
          lastSeen: record.lastSeen,
          machineId: record.machineId,
          instanceId: record.instanceId,
        };
      }
    }
    return latest;
  },
});
