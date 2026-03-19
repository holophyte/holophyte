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

/** Create a user + org as owner, return everything. */
async function setupOwnerWithOrg(t: ReturnType<typeof convexTest>) {
  const { userId, authed } = await setupUser(t, 'Owner');
  const orgId = await authed.mutation(api.organizations.create, {
    name: 'Test Org',
    slug: 'test-org',
  });
  return { userId, authed, orgId };
}

describe('companionHeartbeat — upsert by (orgId, instanceId)', () => {
  it('two calls with different instanceId but same machineId create separate rows', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    await authed.mutation(api.companion.companionHeartbeat, {
      activeSessionCount: 1,
      machineId: 'machine-abc',
      instanceId: 'instance-1',
      url: 'http://localhost:3000',
    });

    await authed.mutation(api.companion.companionHeartbeat, {
      activeSessionCount: 2,
      machineId: 'machine-abc',
      instanceId: 'instance-2',
      url: 'http://localhost:3000',
    });

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('companion')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect();
    });

    expect(rows).toHaveLength(2);
    const instanceIds = rows.map((r) => r.instanceId).sort();
    expect(instanceIds).toEqual(['instance-1', 'instance-2']);
  });

  it('two calls with same instanceId update the same row', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    await authed.mutation(api.companion.companionHeartbeat, {
      activeSessionCount: 1,
      machineId: 'machine-abc',
      instanceId: 'instance-shared',
      url: 'http://localhost:3000',
    });

    // Small delay to ensure a different lastSeen timestamp
    await new Promise((r) => setTimeout(r, 5));

    await authed.mutation(api.companion.companionHeartbeat, {
      activeSessionCount: 5,
      machineId: 'machine-abc',
      instanceId: 'instance-shared',
      url: 'http://localhost:3000',
    });

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('companion')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect();
    });

    // Must be exactly one row — upserted, not duplicated
    expect(rows).toHaveLength(1);
    expect(rows[0]?.instanceId).toBe('instance-shared');
    // The second call's activeSessionCount should win
    expect(rows[0]?.activeSessionCount).toBe(5);
  });
});

describe('companionGetStatus', () => {
  it('returns instanceId, lastSeen, and machineId', async () => {
    const t = convexTest(schema);
    const { authed } = await setupOwnerWithOrg(t);

    const before = Date.now();
    await authed.mutation(api.companion.companionHeartbeat, {
      activeSessionCount: 3,
      machineId: 'machine-xyz',
      instanceId: 'instance-abc',
      url: 'http://localhost:4000',
    });
    const after = Date.now();

    const status = await authed.query(api.companion.companionGetStatus, {});

    expect(status).not.toBeNull();
    expect(status?.instanceId).toBe('instance-abc');
    expect(status?.machineId).toBe('machine-xyz');
    expect(status?.lastSeen).toBeGreaterThanOrEqual(before);
    expect(status?.lastSeen).toBeLessThanOrEqual(after);
  });

  it('returns null when no heartbeat exists', async () => {
    const t = convexTest(schema);
    const { authed } = await setupOwnerWithOrg(t);

    const status = await authed.query(api.companion.companionGetStatus, {});
    expect(status).toBeNull();
  });

  it('returns the most recently seen record across multiple instances', async () => {
    const t = convexTest(schema);
    const { authed } = await setupOwnerWithOrg(t);

    await authed.mutation(api.companion.companionHeartbeat, {
      activeSessionCount: 1,
      machineId: 'machine-abc',
      instanceId: 'instance-old',
    });

    // Small delay so the second heartbeat has a strictly later lastSeen
    await new Promise((r) => setTimeout(r, 5));

    await authed.mutation(api.companion.companionHeartbeat, {
      activeSessionCount: 2,
      machineId: 'machine-abc',
      instanceId: 'instance-new',
    });

    const status = await authed.query(api.companion.companionGetStatus, {});
    expect(status?.instanceId).toBe('instance-new');
  });

  it('throws when unauthenticated', async () => {
    const t = convexTest(schema);

    await expect(t.query(api.companion.companionGetStatus, {})).rejects.toThrow(
      'Not authenticated',
    );
  });
});

describe('upsertHeartbeat (internal) — upserts by instanceId', () => {
  it('two calls with different instanceId create separate rows for the same org', async () => {
    const t = convexTest(schema);
    const { orgId } = await setupOwnerWithOrg(t);

    await t.mutation(internal.companion.upsertHeartbeat, {
      orgId,
      activeSessionCount: 1,
      machineId: 'machine-internal',
      instanceId: 'int-instance-1',
    });

    await t.mutation(internal.companion.upsertHeartbeat, {
      orgId,
      activeSessionCount: 2,
      machineId: 'machine-internal',
      instanceId: 'int-instance-2',
    });

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('companion')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect();
    });

    expect(rows).toHaveLength(2);
    const instanceIds = rows.map((r) => r.instanceId).sort();
    expect(instanceIds).toEqual(['int-instance-1', 'int-instance-2']);
  });

  it('two calls with same instanceId update the same row', async () => {
    const t = convexTest(schema);
    const { orgId } = await setupOwnerWithOrg(t);

    await t.mutation(internal.companion.upsertHeartbeat, {
      orgId,
      activeSessionCount: 1,
      machineId: 'machine-internal',
      instanceId: 'int-shared',
    });

    await new Promise((r) => setTimeout(r, 5));

    await t.mutation(internal.companion.upsertHeartbeat, {
      orgId,
      activeSessionCount: 7,
      machineId: 'machine-internal',
      instanceId: 'int-shared',
    });

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('companion')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect();
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.instanceId).toBe('int-shared');
    expect(rows[0]?.activeSessionCount).toBe(7);
  });

  it('rejects non-localhost URLs', async () => {
    const t = convexTest(schema);
    const { orgId } = await setupOwnerWithOrg(t);

    await expect(
      t.mutation(internal.companion.upsertHeartbeat, {
        orgId,
        activeSessionCount: 1,
        url: 'https://evil.example.com',
      }),
    ).rejects.toThrow('Companion URL must be http://localhost');
  });

  it('accepts http://127.0.0.1:<port> URLs', async () => {
    const t = convexTest(schema);
    const { orgId } = await setupOwnerWithOrg(t);

    await expect(
      t.mutation(internal.companion.upsertHeartbeat, {
        orgId,
        activeSessionCount: 1,
        url: 'http://127.0.0.1:5000',
        instanceId: 'loopback-instance',
      }),
    ).resolves.not.toThrow();

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('companion')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect();
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe('http://127.0.0.1:5000');
  });
});
