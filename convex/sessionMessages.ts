import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import {
  getUserOrgIds,
  requireAuth,
  requireOrgMembership,
  requireRole,
  requireSessionOwnership,
} from './lib/auth';

/**
 * Sends a follow-up message to a session.
 *
 * Writes to the `sessionMessages` table for the companion to pick up and
 * inject into the running SDK process. Requires at least `member` role.
 */
export const send = mutation({
  args: {
    sessionId: v.id('sessions'),
    text: v.string(),
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

    return await ctx.db.insert('sessionMessages', {
      sessionId: args.sessionId,
      text: args.text,
      consumed: false,
      createdAt: Date.now(),
    });
  },
});

/**
 * Shared implementation for listPending and companionListPending.
 * When `orgIds` is provided, only returns messages for sessions whose repo
 * belongs to one of those orgs (used by the public companion query).
 */
async function fetchPendingMessages(
  ctx: QueryCtx,
  orgIds?: Set<Id<'organizations'>>,
) {
  const running = await ctx.db
    .query('sessions')
    .withIndex('by_status', (q) => q.eq('status', 'running'))
    .collect();
  const result = [];
  for (const session of running) {
    if (orgIds) {
      const task = await ctx.db.get(session.taskId);
      if (!task) continue;
      const repo = await ctx.db.get(task.repoId);
      if (!repo || !orgIds.has(repo.orgId)) continue;
    }
    const messages = await ctx.db
      .query('sessionMessages')
      .withIndex('by_session_pending', (q) =>
        q.eq('sessionId', session._id).eq('consumed', false),
      )
      .collect();
    result.push(...messages);
  }
  return result;
}

/**
 * Returns unconsumed messages for active sessions.
 *
 * The companion polls this to find messages that need to be delivered to
 * running SDK processes. Internal — not callable from the browser.
 */
export const listPending = internalQuery({
  args: {},
  handler: async (ctx) => {
    return fetchPendingMessages(ctx);
  },
});

/**
 * Marks a session message as consumed by the companion.
 *
 * Internal — called after the companion successfully delivers the message
 * to the SDK process.
 */
export const markConsumed = internalMutation({
  args: { id: v.id('sessionMessages') },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) return;
    await ctx.db.patch(args.id, { consumed: true });
  },
});

/**
 * Public companion query: returns unconsumed messages for running sessions.
 *
 * Accessible to the companion via ConvexClient subscriptions. Requires JWT
 * authentication via `ConvexClient.setAuth()`.
 *
 * Scoped to the authenticated user's orgs — the companion can only see
 * messages for sessions in orgs it is a member of.
 */
export const companionListPending = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserOrgIds(ctx, userId);
    return fetchPendingMessages(ctx, orgIds);
  },
});

/**
 * Marks a session message as consumed.
 * Public equivalent of {@link markConsumed} — authenticated via JWT.
 */
export const companionMarkConsumed = mutation({
  args: { id: v.id('sessionMessages') },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) return;
    // Verify caller owns the message's session
    await requireSessionOwnership(ctx, msg.sessionId);
    await ctx.db.patch(args.id, { consumed: true });
  },
});
