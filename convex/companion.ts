import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { getUserOrgIds, requireAuth, requireOrgMembership } from './lib/auth';

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

/**
 * Upsert a companion heartbeat for every org in the deployment.
 * The companion serves the entire deployment, so all orgs should see it.
 */
export const upsertHeartbeatAllOrgs = internalMutation({
  args: {
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
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
        .withIndex('by_org_machine', (q) =>
          q.eq('orgId', org._id).eq('machineId', args.machineId),
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
          orgId: org._id,
          lastSeen: Date.now(),
          activeSessionCount: args.activeSessionCount,
          machineId: args.machineId,
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
 * Public equivalent of {@link upsertHeartbeatAllOrgs} — scoped to user's orgs.
 */
export const companionHeartbeat = mutation({
  args: {
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserOrgIds(ctx, userId);
    await upsertHeartbeatForOrgs(ctx, [...orgIds], args);
  },
});

/**
 * Returns the most recent companion heartbeat for the user's first org.
 * Public equivalent of the `/api/internal/companion/status` HTTP endpoint.
 */
export const companionGetStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserOrgIds(ctx, userId);
    const firstOrgId = [...orgIds][0];
    if (!firstOrgId) return null;
    const record = await ctx.db
      .query('companion')
      .withIndex('by_org_last_seen', (q) => q.eq('orgId', firstOrgId))
      .order('desc')
      .first();
    return record
      ? { lastSeen: record.lastSeen, machineId: record.machineId }
      : null;
  },
});
