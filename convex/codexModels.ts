import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireAuth } from './lib/auth';

const modelEntry = v.object({
  id: v.string(),
  label: v.string(),
  description: v.string(),
});

// Companion-only: invoked from the /api/internal/codex-models/replace HTTP action.
export const replace = internalMutation({
  args: { models: v.array(modelEntry) },
  handler: async (ctx, { models }) => {
    if (models.length === 0) return;
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
