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
    const now = Date.now();
    const existing = await ctx.db
      .query('companion')
      .withIndex('by_org_instance', (q) =>
        q.eq('orgId', args.orgId).eq('instanceId', args.instanceId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: now,
        activeSessionCount: args.activeSessionCount,
        ...(args.machineId !== undefined && { machineId: args.machineId }),
        instanceId: args.instanceId,
        ...(args.url !== undefined && { url: args.url }),
      });
    } else {
      await ctx.db.insert('companion', {
        orgId: args.orgId,
        lastSeen: now,
        activeSessionCount: args.activeSessionCount,
        machineId: args.machineId,
        instanceId: args.instanceId,
        url: args.url,
      });
    }

    // Clean up stale rows from previous instances for this org
    await purgeStaleCompanionRows(ctx, args.orgId, now);
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

    const now = Date.now();
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
          lastSeen: now,
          activeSessionCount: args.activeSessionCount,
          ...(args.machineId !== undefined && { machineId: args.machineId }),
          instanceId: args.instanceId,
          ...(args.url !== undefined && { url: args.url }),
        });
      } else {
        await ctx.db.insert('companion', {
          orgId: org._id,
          lastSeen: now,
          activeSessionCount: args.activeSessionCount,
          machineId: args.machineId,
          instanceId: args.instanceId,
          url: args.url,
        });
      }

      await purgeStaleCompanionRows(ctx, org._id, now);
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

// ── Cleanup ──────────────────────────────────────────────────────────

/** Max age before a companion row is considered stale and eligible for deletion. */
const STALE_THRESHOLD_MS = 60_000;

/**
 * Delete companion rows for the given org where `lastSeen` is older than the
 * stale threshold. Runs inline during heartbeat upserts so rows from previous
 * process restarts don't accumulate unboundedly.
 */
async function purgeStaleCompanionRows(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  now: number,
) {
  const cutoff = now - STALE_THRESHOLD_MS;
  const staleRows = await ctx.db
    .query('companion')
    .withIndex('by_org_last_seen', (q) =>
      q.eq('orgId', orgId).lt('lastSeen', cutoff),
    )
    .collect();
  for (const row of staleRows) {
    await ctx.db.delete(row._id);
  }
}

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

  const now = Date.now();
  for (const orgId of orgIds) {
    const existing = await ctx.db
      .query('companion')
      .withIndex('by_org_instance', (q) =>
        q.eq('orgId', orgId).eq('instanceId', args.instanceId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: now,
        activeSessionCount: args.activeSessionCount,
        ...(args.machineId !== undefined && { machineId: args.machineId }),
        instanceId: args.instanceId,
        ...(args.url !== undefined && { url: args.url }),
      });
    } else {
      await ctx.db.insert('companion', {
        orgId,
        lastSeen: now,
        activeSessionCount: args.activeSessionCount,
        machineId: args.machineId,
        instanceId: args.instanceId,
        url: args.url,
      });
    }

    await purgeStaleCompanionRows(ctx, orgId, now);
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
