// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from '../schema';
import { requireAuth, requireOrgMembership, requireRole } from './auth';

/** Create a user and return their ID. */
async function createUser(
  t: ReturnType<typeof convexTest>,
  name = 'Test User',
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', { name });
  });
}

/** Create a user + org + membership. Returns { userId, orgId, membershipId }. */
async function createUserWithOrg(
  t: ReturnType<typeof convexTest>,
  role: 'owner' | 'admin' | 'member' | 'viewer' = 'owner',
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { name: 'Test User' });
    const orgId = await ctx.db.insert('organizations', {
      name: 'Test Org',
      slug: 'test-org',
      personal: false,
    });
    const membershipId = await ctx.db.insert('memberships', {
      userId,
      orgId,
      role,
    });
    return { userId, orgId, membershipId };
  });
}

describe('requireAuth', () => {
  it('returns userId when authenticated', async () => {
    const t = convexTest(schema);
    const userId = await createUser(t);
    const authed = t.withIdentity({ subject: `${userId}|session123` });

    const result = await authed.run(async (ctx) => {
      return await requireAuth(ctx);
    });
    expect(result).toBe(userId);
  });

  it('throws when not authenticated', async () => {
    const t = convexTest(schema);

    await expect(
      t.run(async (ctx) => {
        return await requireAuth(ctx);
      }),
    ).rejects.toThrow('Not authenticated');
  });
});

describe('requireOrgMembership', () => {
  it('returns userId and membership for valid members', async () => {
    const t = convexTest(schema);
    const { userId, orgId, membershipId } = await createUserWithOrg(t);
    const authed = t.withIdentity({ subject: `${userId}|session123` });

    const result = await authed.run(async (ctx) => {
      return await requireOrgMembership(ctx, orgId);
    });
    expect(result.userId).toBe(userId);
    expect(result.membership._id).toBe(membershipId);
    expect(result.membership.role).toBe('owner');
  });

  it('throws for non-members', async () => {
    const t = convexTest(schema);
    const { orgId } = await createUserWithOrg(t);

    // Create a different user who is NOT a member
    const otherUserId = await createUser(t, 'Other User');
    const authed = t.withIdentity({ subject: `${otherUserId}|session456` });

    await expect(
      authed.run(async (ctx) => {
        return await requireOrgMembership(ctx, orgId);
      }),
    ).rejects.toThrow('Not a member of this organization');
  });

  it('throws when not authenticated', async () => {
    const t = convexTest(schema);
    const { orgId } = await createUserWithOrg(t);

    await expect(
      t.run(async (ctx) => {
        return await requireOrgMembership(ctx, orgId);
      }),
    ).rejects.toThrow('Not authenticated');
  });
});

describe('requireRole', () => {
  it('passes when role meets minimum', async () => {
    const t = convexTest(schema);
    const { membershipId } = await createUserWithOrg(t, 'admin');

    const membership = await t.run(async (ctx) => {
      const m = await ctx.db.get(membershipId);
      if (!m) throw new Error('membership not found');
      return m;
    });

    // admin >= member should pass
    expect(() => requireRole(membership, 'member')).not.toThrow();
    // admin >= admin should pass
    expect(() => requireRole(membership, 'admin')).not.toThrow();
    // admin >= viewer should pass
    expect(() => requireRole(membership, 'viewer')).not.toThrow();
  });

  it('throws when role is below minimum', async () => {
    const t = convexTest(schema);
    const { membershipId } = await createUserWithOrg(t, 'member');

    const membership = await t.run(async (ctx) => {
      const m = await ctx.db.get(membershipId);
      if (!m) throw new Error('membership not found');
      return m;
    });

    // member < admin should throw
    expect(() => requireRole(membership, 'admin')).toThrow(
      'Requires admin role or higher',
    );
    // member < owner should throw
    expect(() => requireRole(membership, 'owner')).toThrow(
      'Requires owner role or higher',
    );
  });

  it('viewer cannot access member-level resources', async () => {
    const t = convexTest(schema);
    const { membershipId } = await createUserWithOrg(t, 'viewer');

    const membership = await t.run(async (ctx) => {
      const m = await ctx.db.get(membershipId);
      if (!m) throw new Error('membership not found');
      return m;
    });

    expect(() => requireRole(membership, 'member')).toThrow(
      'Requires member role or higher',
    );
  });
});
