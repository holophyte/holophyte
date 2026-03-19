import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { requireOrgMembership, requireSessionOwnership } from './lib/auth';

/** Server-side mutation for batched event persistence. */
export const insertBatch = internalMutation({
  args: {
    sessionId: v.id('sessions'),
    events: v.array(
      v.object({
        type: v.string(),
        data: v.string(), // JSON-serialized SDKMessage
        timestamp: v.number(),
      }),
    ),
    batchIndex: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('sessionEvents', {
      sessionId: args.sessionId,
      events: args.events,
      batchIndex: args.batchIndex,
    });
  },
});

/** Return the next available batchIndex for a session (max + 1, or 0). */
export const getNextBatchIndex = internalQuery({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    const lastBatch = await ctx.db
      .query('sessionEvents')
      .withIndex('by_session_batch', (q) => q.eq('sessionId', args.sessionId))
      .order('desc')
      .first();
    return { nextBatchIndex: lastBatch ? lastBatch.batchIndex + 1 : 0 };
  },
});

// ── Public companion mutations/queries (JWT-authenticated) ──────────

/** Batched event persistence. Public equivalent of {@link insertBatch}. */
export const companionInsertBatch = mutation({
  args: {
    sessionId: v.id('sessions'),
    events: v.array(
      v.object({
        type: v.string(),
        data: v.string(),
        timestamp: v.number(),
      }),
    ),
    batchIndex: v.number(),
  },
  handler: async (ctx, args) => {
    await requireSessionOwnership(ctx, args.sessionId);
    await ctx.db.insert('sessionEvents', {
      sessionId: args.sessionId,
      events: args.events,
      batchIndex: args.batchIndex,
    });
  },
});

/** Next available batchIndex. Public equivalent of {@link getNextBatchIndex}. */
export const companionGetNextBatchIndex = query({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    await requireSessionOwnership(ctx, args.sessionId);
    const lastBatch = await ctx.db
      .query('sessionEvents')
      .withIndex('by_session_batch', (q) => q.eq('sessionId', args.sessionId))
      .order('desc')
      .first();
    return { nextBatchIndex: lastBatch ? lastBatch.batchIndex + 1 : 0 };
  },
});

/** Retrieve all event batches for a session, ordered by batchIndex. */
export const getBySession = query({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    // Auth: verify caller has access to this session's org
    const session = await ctx.db.get(args.sessionId);
    if (!session) return [];
    const task = await ctx.db.get(session.taskId);
    if (!task) return [];
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return [];
    await requireOrgMembership(ctx, repo.orgId);

    return await ctx.db
      .query('sessionEvents')
      .withIndex('by_session_batch', (q) => q.eq('sessionId', args.sessionId))
      .order('asc')
      .collect();
  },
});
