import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireAuth } from './lib/auth';

const modelEntry = v.object({
  id: v.string(),
  label: v.string(),
  description: v.string(),
});

/**
 * Replace the single-row `codexModels` cache with a fresh snapshot. Invoked
 * by the companion on startup after probing the live `codex app-server`
 * model/list RPC. Upsert semantics via first-row patch so the table never
 * grows past one row.
 */
export const replace = mutation({
  args: { models: v.array(modelEntry) },
  handler: async (ctx, { models }) => {
    await requireAuth(ctx);
    const existing = await ctx.db.query('codexModels').first();
    const fetchedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { models, fetchedAt });
    } else {
      await ctx.db.insert('codexModels', { models, fetchedAt });
    }
  },
});

/** Current Codex model cache, or `null` before the companion has probed. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.db.query('codexModels').first();
  },
});
