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
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    const name = args.name.trim();
    if (!name || name.length > 256)
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
      name,
      scopes: args.scopes,
      ...(args.expiresAt !== undefined && { expiresAt: args.expiresAt }),
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
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('apiKeys', args);
  },
});

/**
 * Regenerates an API key: revokes the old one and creates a new key
 * with the same name, scopes, and expiry duration. Returns the new raw key.
 */
export const regenerate = action({
  args: {
    keyId: v.id('apiKeys'),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    const oldKey = await ctx.runQuery(internal.apiKeys.getKey, {
      keyId: args.keyId,
    });
    if (!oldKey) throw new Error('API key not found');
    if (oldKey.userId !== userId)
      throw new Error('Not authorized to regenerate this key');

    // Calculate new expiresAt based on old key's duration
    let expiresAt: number | undefined;
    if (oldKey.expiresAt !== undefined) {
      const duration = oldKey.expiresAt - oldKey._creationTime;
      expiresAt = Date.now() + duration;
    }

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    const rawKey = `holo_${hex}`;
    const hashedKey = await hashApiKey(rawKey);

    await ctx.runMutation(internal.apiKeys.revokeAndInsert, {
      oldKeyId: args.keyId,
      userId,
      hashedKey,
      name: oldKey.name,
      scopes: oldKey.scopes,
      expiresAt,
    });

    return rawKey;
  },
});

/** Internal query to get a key doc by ID. */
export const getKey = internalQuery({
  args: { keyId: v.id('apiKeys') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.keyId);
  },
});

/** Internal mutation to revoke old key and insert new one atomically. */
export const revokeAndInsert = internalMutation({
  args: {
    oldKeyId: v.id('apiKeys'),
    userId: v.id('users'),
    hashedKey: v.string(),
    name: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const oldKey = await ctx.db.get(args.oldKeyId);
    if (!oldKey) throw new Error('API key not found');
    if (oldKey.userId !== args.userId)
      throw new Error('Not authorized to regenerate this key');
    if (oldKey.revokedAt !== undefined)
      throw new Error('Cannot regenerate a revoked key');

    await ctx.db.patch(args.oldKeyId, { revokedAt: Date.now() });
    return await ctx.db.insert('apiKeys', {
      userId: args.userId,
      hashedKey: args.hashedKey,
      name: args.name,
      scopes: args.scopes,
      ...(args.expiresAt !== undefined && { expiresAt: args.expiresAt }),
    });
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
 * Updates an API key's name and/or scopes. Verifies ownership before updating.
 */
export const update = mutation({
  args: {
    keyId: v.id('apiKeys'),
    name: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const key = await ctx.db.get(args.keyId);
    if (!key) throw new Error('API key not found');
    if (key.userId !== userId)
      throw new Error('Not authorized to update this key');

    const patch: Record<string, unknown> = {};

    if (args.name !== undefined) {
      if (!args.name.trim() || args.name.length > 256)
        throw new Error('Name must be between 1 and 256 characters');
      patch.name = args.name.trim();
    }

    if (args.scopes !== undefined) {
      const VALID_SCOPES = ['mcp'];
      const invalid = args.scopes.filter((s) => !VALID_SCOPES.includes(s));
      if (invalid.length > 0)
        throw new Error(`Invalid scopes: ${invalid.join(', ')}`);
      if (args.scopes.length === 0)
        throw new Error('At least one scope required');
      patch.scopes = args.scopes;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.keyId, patch);
    }
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
 * Internal mutation to validate an API key by hash and update `lastUsedAt` atomically.
 * Returns `{ keyId, userId }` on success, or `null` if the key is invalid/revoked/expired.
 * Combining validation and the touch into one mutation prevents TOCTOU races.
 */
export const validateAndTouch = internalMutation({
  args: {
    hashedKey: v.string(),
    scope: v.string(),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query('apiKeys')
      .withIndex('by_hashed_key', (q) => q.eq('hashedKey', args.hashedKey))
      .first();

    if (!key) return null;
    if (key.revokedAt !== undefined) return null;
    if (key.expiresAt !== undefined && key.expiresAt < Date.now()) return null;
    if (!key.scopes.includes(args.scope)) return null;

    await ctx.db.patch(key._id, { lastUsedAt: Date.now() });
    return { keyId: key._id, userId: key.userId };
  },
});
