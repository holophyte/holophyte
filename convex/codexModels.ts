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
 *
 * Trust model: writable by any authenticated user. Convex Auth doesn't
 * distinguish "companion" from "browser," and the same pattern is used
 * by `companion.ts` mutations. The table is deliberately global (no
 * orgId scoping — spec Task 2), so a writer from one org updates the
 * cache seen by every org. Blast radius is the model picker UI only;
 * the list is not a security boundary. If this ever becomes untrusted,
 * switch to an `internalMutation` invoked from an HTTP action guarded
 * by `INTERNAL_API_SECRET`.
 */
export const replace = mutation({
  args: { models: v.array(modelEntry) },
  handler: async (ctx, { models }) => {
    await requireAuth(ctx);
    // Reject empty snapshots so a well-formed-but-useless write from any
    // authenticated client can't nullify the cached list and force the UI
    // onto the fallback. The probe already skips empty `data` upstream;
    // this is the defense-in-depth check at the mutation boundary.
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
