import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { hashApiKey } from './lib/apiKeyHash';
import { requireAuth } from './lib/auth';

/**
 * Generates a new API key for the authenticated user.
 *
 * Must be an action (not a mutation) because `crypto.getRandomValues` is
 * non-deterministic — Convex mutations must be deterministic for replay.
 *
 * Generates 32 random bytes → hex → prefixed with `holo_` → hashes with
 * SHA-256 → stores hash + metadata via internalMutation → returns the raw
 * key string exactly once. The raw key is never stored.
 */
export const generate = action({
  args: {
    name: v.string(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    if (!args.name.trim() || args.name.length > 256)
      throw new Error('Name must be between 1 and 256 characters');

    // Validate scopes against known values
    const VALID_SCOPES = ['mcp'];
    const invalid = args.scopes.filter((s) => !VALID_SCOPES.includes(s));
    if (invalid.length > 0)
      throw new Error(`Invalid scopes: ${invalid.join(', ')}`);
    if (args.scopes.length === 0)
      throw new Error('At least one scope required');

    // Generate 32 random bytes → 64 hex chars → holo_<64hex> = 69 chars total
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    const rawKey = `holo_${hex}`;

    const hashedKey = await hashApiKey(rawKey);

    await ctx.runMutation(internal.apiKeys.insertKey, {
      userId,
      hashedKey,
      name: args.name,
      scopes: args.scopes,
    });

    return rawKey;
  },
});

/**
 * Internal mutation to insert a new API key doc.
 * Called by the `generate` action after hashing the raw key.
 */
export const insertKey = internalMutation({
  args: {
    userId: v.id('users'),
    hashedKey: v.string(),
    name: v.string(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('apiKeys', args);
  },
});

/**
 * Revokes an API key by setting `revokedAt`.
 * Verifies that the key belongs to the authenticated user before revoking.
 */
export const revoke = mutation({
  args: {
    keyId: v.id('apiKeys'),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const key = await ctx.db.get(args.keyId);
    if (!key) throw new Error('API key not found');
    if (key.userId !== userId)
      throw new Error('Not authorized to revoke this key');

    await ctx.db.patch(args.keyId, { revokedAt: Date.now() });
  },
});

/**
 * Lists all API keys for the authenticated user.
 * Strips `hashedKey` from results — the hash is never exposed to the frontend.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);

    const keys = await ctx.db
      .query('apiKeys')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    return keys.map(({ hashedKey: _hashedKey, ...rest }) => rest);
  },
});

/**
 * Internal query to look up an API key by its SHA-256 hash.
 * Returns the full doc (including userId) or null if not found / revoked.
 * Used by the HTTP exchange endpoint.
 */
export const validateByHash = internalQuery({
  args: {
    hashedKey: v.string(),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query('apiKeys')
      .withIndex('by_hashed_key', (q) => q.eq('hashedKey', args.hashedKey))
      .first();

    if (!key) return null;
    if (key.revokedAt !== undefined) return null;

    return key;
  },
});

/**
 * Internal mutation to update `lastUsedAt` on an API key.
 * Called after a successful key validation in the HTTP exchange endpoint.
 */
export const updateLastUsedAt = internalMutation({
  args: {
    keyId: v.id('apiKeys'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, { lastUsedAt: Date.now() });
  },
});
