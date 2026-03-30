// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

/** Create a user and return an authenticated test client + userId. */
async function setupUser(t: ReturnType<typeof convexTest>, name = 'Test User') {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert('users', { name });
  });
  return { userId, authed: t.withIdentity({ subject: `${userId}|s1` }) };
}

describe('apiKeys.generate', () => {
  it('returns a key starting with holo_', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    const rawKey = await authed.action(api.apiKeys.generate, {
      name: 'My MCP Key',
      scopes: ['mcp'],
    });

    expect(typeof rawKey).toBe('string');
    expect(rawKey).toMatch(/^holo_[0-9a-f]{64}$/);
  });

  it('stores only the hash — not the raw key — in the database', async () => {
    const t = convexTest(schema);
    const { userId, authed } = await setupUser(t);

    const rawKey = await authed.action(api.apiKeys.generate, {
      name: 'Test Key',
      scopes: ['mcp'],
    });

    const docs = await t.run(async (ctx) => {
      return ctx.db
        .query('apiKeys')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect();
    });

    expect(docs).toHaveLength(1);
    // Use toMatchObject to assert fields without non-null assertions
    expect(docs[0]).toMatchObject({
      name: 'Test Key',
      scopes: ['mcp'],
    });
    // Stored key must not contain the raw key
    const storedDoc = docs[0];
    if (!storedDoc) throw new Error('Expected a stored doc');
    expect(storedDoc.hashedKey).not.toBe(rawKey);
    // Hash should be 64 hex chars (SHA-256)
    expect(storedDoc.hashedKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires authentication', async () => {
    const t = convexTest(schema);

    await expect(
      t.action(api.apiKeys.generate, { name: 'Key', scopes: ['mcp'] }),
    ).rejects.toThrow('Not authenticated');
  });

  it('generates unique keys on each call', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    const key1 = await authed.action(api.apiKeys.generate, {
      name: 'Key 1',
      scopes: ['mcp'],
    });
    const key2 = await authed.action(api.apiKeys.generate, {
      name: 'Key 2',
      scopes: ['mcp'],
    });

    expect(key1).not.toBe(key2);
  });
});

describe('apiKeys.list', () => {
  it('returns key metadata without hashedKey', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    await authed.action(api.apiKeys.generate, {
      name: 'MCP Key',
      scopes: ['mcp'],
    });

    const keys = await authed.query(api.apiKeys.list, {});

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      name: 'MCP Key',
      scopes: ['mcp'],
    });
    // hashedKey must not be exposed
    expect(keys[0]).not.toHaveProperty('hashedKey');
    // Convex built-in fields should be present
    const firstKey = keys[0];
    if (!firstKey) throw new Error('Expected a key');
    expect(firstKey._id).toBeDefined();
    expect(firstKey._creationTime).toBeDefined();
  });

  it('only returns keys for the authenticated user', async () => {
    const t = convexTest(schema);
    const { authed: user1 } = await setupUser(t, 'User 1');
    const { authed: user2 } = await setupUser(t, 'User 2');

    await user1.action(api.apiKeys.generate, {
      name: 'User1 Key',
      scopes: ['mcp'],
    });

    const user2Keys = await user2.query(api.apiKeys.list, {});
    expect(user2Keys).toHaveLength(0);

    const user1Keys = await user1.query(api.apiKeys.list, {});
    expect(user1Keys).toHaveLength(1);
  });

  it('requires authentication', async () => {
    const t = convexTest(schema);

    await expect(t.query(api.apiKeys.list, {})).rejects.toThrow(
      'Not authenticated',
    );
  });
});

describe('apiKeys.revoke', () => {
  it('sets revokedAt on the key', async () => {
    const t = convexTest(schema);
    const { userId, authed } = await setupUser(t);

    await authed.action(api.apiKeys.generate, {
      name: 'Key to revoke',
      scopes: ['mcp'],
    });

    const keys = await authed.query(api.apiKeys.list, {});
    const firstKey = keys[0];
    if (!firstKey) throw new Error('Expected a key');
    expect(firstKey.revokedAt).toBeUndefined();

    const before = Date.now();
    await authed.mutation(api.apiKeys.revoke, { keyId: firstKey._id });
    const after = Date.now();

    // Verify revokedAt was set in the DB
    const doc = await t.run(async (ctx) => ctx.db.get(firstKey._id));
    if (!doc) throw new Error('Expected doc to exist');
    expect(doc.revokedAt).toBeGreaterThanOrEqual(before);
    expect(doc.revokedAt).toBeLessThanOrEqual(after);
    expect(doc.userId).toBe(userId);
  });

  it('rejects revocation by a different user', async () => {
    const t = convexTest(schema);
    const { authed: owner } = await setupUser(t, 'Owner');
    const { authed: attacker } = await setupUser(t, 'Attacker');

    await owner.action(api.apiKeys.generate, {
      name: 'Owner Key',
      scopes: ['mcp'],
    });

    const ownerKeys = await owner.query(api.apiKeys.list, {});
    const ownerKey = ownerKeys[0];
    if (!ownerKey) throw new Error('Expected owner key');

    await expect(
      attacker.mutation(api.apiKeys.revoke, { keyId: ownerKey._id }),
    ).rejects.toThrow('Not authorized to revoke this key');
  });

  it('throws when key does not exist', async () => {
    const t = convexTest(schema);
    const { userId, authed } = await setupUser(t);

    // Insert and delete a key to get a valid-shaped but missing ID
    const keyId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('apiKeys', {
        userId,
        hashedKey: 'deadbeef',
        name: 'Temp',
        scopes: ['mcp'],
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      authed.mutation(api.apiKeys.revoke, { keyId }),
    ).rejects.toThrow('API key not found');
  });
});

describe('apiKeys.validateByHash (internal)', () => {
  it('returns the key doc for a valid unrevoked key', async () => {
    const t = convexTest(schema);
    const { userId, authed } = await setupUser(t);

    const rawKey = await authed.action(api.apiKeys.generate, {
      name: 'Valid Key',
      scopes: ['mcp'],
    });

    // Hash the raw key using the same algorithm
    const encoded = new TextEncoder().encode(rawKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashedKey = Array.from(new Uint8Array(hashBuffer), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');

    const result = await t.run(async (ctx) => {
      return ctx.runQuery(internal.apiKeys.validateByHash, { hashedKey });
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      userId,
      scopes: ['mcp'],
    });
  });

  it('returns null for an unknown hash', async () => {
    const t = convexTest(schema);

    const result = await t.run(async (ctx) => {
      return ctx.runQuery(internal.apiKeys.validateByHash, {
        hashedKey: 'a'.repeat(64),
      });
    });

    expect(result).toBeNull();
  });

  it('returns null for a revoked key', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    const rawKey = await authed.action(api.apiKeys.generate, {
      name: 'Revoke Me',
      scopes: ['mcp'],
    });

    const keys = await authed.query(api.apiKeys.list, {});
    const keyToRevoke = keys[0];
    if (!keyToRevoke) throw new Error('Expected a key');

    await authed.mutation(api.apiKeys.revoke, { keyId: keyToRevoke._id });

    // Hash the raw key
    const encoded = new TextEncoder().encode(rawKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashedKey = Array.from(new Uint8Array(hashBuffer), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');

    const result = await t.run(async (ctx) => {
      return ctx.runQuery(internal.apiKeys.validateByHash, { hashedKey });
    });

    expect(result).toBeNull();
  });
});
