import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import {
  isLocalDevMode,
  requireOrgMembership,
  requireRole,
  requireSessionOwnership,
} from './lib/auth';

// ── Internal functions (companion via HTTP) ─────────────────────────

/**
 * Creates a pending approval record.
 *
 * Called by the companion when `canUseTool` fires for a non-auto-approved tool.
 * The frontend subscribes via {@link getBySession} and shows the approval UI.
 */
export const serverCreate = internalMutation({
  args: {
    sessionId: v.id('sessions'),
    requestId: v.string(),
    tool: v.string(),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('pendingApprovals', {
      sessionId: args.sessionId,
      requestId: args.requestId,
      tool: args.tool,
      input: args.input,
      resolved: false,
      consumed: false,
    });
  },
});

/**
 * Returns resolved-but-unconsumed approvals for a session.
 *
 * The companion polls this to discover approvals that the frontend has
 * resolved so it can unpark the SDK's `canUseTool` Promise.
 */
export const serverListResolvedUnconsumed = internalQuery({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    const approvals = await ctx.db
      .query('pendingApprovals')
      .withIndex('by_session_unresolved', (q) =>
        q.eq('sessionId', args.sessionId).eq('resolved', true),
      )
      .collect();
    return approvals.filter((a) => !a.consumed);
  },
});

/**
 * Marks an approval as consumed by the companion.
 *
 * Called after the companion reads the resolution and resolves the in-memory
 * `canUseTool` Promise.
 */
export const serverMarkConsumed = internalMutation({
  args: { id: v.id('pendingApprovals') },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.id);
    if (!approval) return;
    await ctx.db.patch(args.id, { consumed: true });
  },
});

/**
 * Denies all unresolved approvals for a session.
 *
 * Called by the companion when a session ends (normally or via abort) to
 * clean up any approvals that were never answered by the frontend.
 */
export const serverDenyAll = internalMutation({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    const unresolved = await ctx.db
      .query('pendingApprovals')
      .withIndex('by_session_unresolved', (q) =>
        q.eq('sessionId', args.sessionId).eq('resolved', false),
      )
      .collect();
    for (const approval of unresolved) {
      await ctx.db.patch(approval._id, {
        resolved: true,
        approved: false,
        denyMessage: 'Session ended',
        consumed: true,
      });
    }
  },
});

// ── Public companion mutations/queries (JWT-authenticated) ──────────

/** Creates a pending approval. Public equivalent of {@link serverCreate}. */
export const companionCreate = mutation({
  args: {
    sessionId: v.id('sessions'),
    requestId: v.string(),
    tool: v.string(),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isLocalDevMode()) await requireSessionOwnership(ctx, args.sessionId);
    await ctx.db.insert('pendingApprovals', {
      sessionId: args.sessionId,
      requestId: args.requestId,
      tool: args.tool,
      input: args.input,
      resolved: false,
      consumed: false,
    });
  },
});

/** Resolved-but-unconsumed approvals. Public equivalent of {@link serverListResolvedUnconsumed}. */
export const companionListResolvedUnconsumed = query({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    if (!isLocalDevMode()) await requireSessionOwnership(ctx, args.sessionId);
    const approvals = await ctx.db
      .query('pendingApprovals')
      .withIndex('by_session_unresolved', (q) =>
        q.eq('sessionId', args.sessionId).eq('resolved', true),
      )
      .collect();
    return approvals.filter((a) => !a.consumed);
  },
});

/** Marks an approval as consumed. Public equivalent of {@link serverMarkConsumed}. */
export const companionMarkConsumed = mutation({
  args: { id: v.id('pendingApprovals') },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.id);
    if (!approval) return;
    if (!isLocalDevMode()) {
      await requireSessionOwnership(ctx, approval.sessionId);
    }
    await ctx.db.patch(args.id, { consumed: true });
  },
});

/**
 * Denies a single unresolved approval, identified by `sessionId` + `requestId`.
 *
 * Used by the Codex bridge when a poll loop times out: the manager has already
 * told Codex to deny, but the persisted row would otherwise stay unresolved
 * until session end. Marking it resolved+consumed here keeps the frontend
 * approval list in sync.
 */
export const companionDenyByRequestId = mutation({
  args: {
    sessionId: v.id('sessions'),
    requestId: v.string(),
    denyMessage: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isLocalDevMode()) {
      await requireSessionOwnership(ctx, args.sessionId);
    }
    const row = await ctx.db
      .query('pendingApprovals')
      .withIndex('by_session_unresolved', (q) =>
        q.eq('sessionId', args.sessionId).eq('resolved', false),
      )
      .filter((q) => q.eq(q.field('requestId'), args.requestId))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      resolved: true,
      approved: false,
      denyMessage: args.denyMessage,
      consumed: true,
    });
  },
});

/** Denies all unresolved approvals. Public equivalent of {@link serverDenyAll}. */
export const companionDenyAll = mutation({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    if (!isLocalDevMode()) {
      await requireSessionOwnership(ctx, args.sessionId);
    }
    const unresolved = await ctx.db
      .query('pendingApprovals')
      .withIndex('by_session_unresolved', (q) =>
        q.eq('sessionId', args.sessionId).eq('resolved', false),
      )
      .collect();
    for (const approval of unresolved) {
      await ctx.db.patch(approval._id, {
        resolved: true,
        approved: false,
        denyMessage: 'Session ended',
        consumed: true,
      });
    }
  },
});

// ── Public functions (frontend via useQuery / useMutation) ──────────

/**
 * Returns all approvals for a session.
 *
 * The frontend subscribes to show pending approval prompts and historical
 * approval context. Requires org membership.
 */
export const getBySession = query({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return [];
    const task = await ctx.db.get(session.taskId);
    if (!task) return [];
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return [];
    await requireOrgMembership(ctx, repo.orgId);
    return await ctx.db
      .query('pendingApprovals')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .collect();
  },
});

/**
 * Resolves a pending approval (approve or deny).
 *
 * Called by the frontend when the user clicks approve/deny in the session UI.
 * The companion polls for resolved approvals via {@link serverListResolvedUnconsumed}.
 * Requires at least `member` role.
 */
export const resolve = mutation({
  args: {
    sessionId: v.id('sessions'),
    requestId: v.string(),
    approved: v.boolean(),
    denyMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error('Session not found');
    const task = await ctx.db.get(session.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');

    const approval = await ctx.db
      .query('pendingApprovals')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .filter((q) => q.eq(q.field('requestId'), args.requestId))
      .first();
    if (!approval) throw new Error('Approval not found');
    if (approval.resolved) throw new Error('Approval already resolved');

    await ctx.db.patch(approval._id, {
      resolved: true,
      approved: args.approved,
      denyMessage: args.denyMessage,
    });
  },
});
