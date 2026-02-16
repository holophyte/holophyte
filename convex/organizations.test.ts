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

describe('organizations.create', () => {
  it('creates an org and auto-creates owner membership', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    const orgId = await authed.mutation(api.organizations.create, {
      name: 'My Org',
      slug: 'my-org',
    });

    const orgs = await authed.query(api.organizations.listByUser);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      _id: orgId,
      name: 'My Org',
      slug: 'my-org',
      personal: false,
      role: 'owner',
    });
  });

  it('rejects duplicate slugs', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    await authed.mutation(api.organizations.create, {
      name: 'First',
      slug: 'same-slug',
    });

    await expect(
      authed.mutation(api.organizations.create, {
        name: 'Second',
        slug: 'same-slug',
      }),
    ).rejects.toThrow('Organization slug already taken');
  });

  it('requires authentication', async () => {
    const t = convexTest(schema);

    await expect(
      t.mutation(api.organizations.create, {
        name: 'Org',
        slug: 'org',
      }),
    ).rejects.toThrow('Not authenticated');
  });
});

describe('organizations.createPersonal', () => {
  it('creates a personal org with owner membership', async () => {
    const t = convexTest(schema);
    const { userId, authed } = await setupUser(t, 'Alice');

    await t.mutation(internal.organizations.createPersonal, {
      userId,
    });

    const orgs = await authed.query(api.organizations.listByUser);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      name: 'Alice',
      personal: true,
      role: 'owner',
    });
    expect(orgs[0]?.slug).toBe(`personal-${userId}`);
  });

  it('is idempotent — calling twice returns the same orgId', async () => {
    const t = convexTest(schema);
    const { userId, authed } = await setupUser(t, 'Bob');

    const orgId1 = await t.mutation(internal.organizations.createPersonal, {
      userId,
    });
    const orgId2 = await t.mutation(internal.organizations.createPersonal, {
      userId,
    });

    expect(orgId1).toBe(orgId2);

    // Should still only have one org and one membership
    const orgs = await authed.query(api.organizations.listByUser);
    expect(orgs).toHaveLength(1);
  });
});

describe('organizations.listByUser', () => {
  it('only shows orgs the user belongs to', async () => {
    const t = convexTest(schema);
    const { authed: user1 } = await setupUser(t, 'User 1');
    const { authed: user2 } = await setupUser(t, 'User 2');

    await user1.mutation(api.organizations.create, {
      name: 'Org A',
      slug: 'org-a',
    });
    await user2.mutation(api.organizations.create, {
      name: 'Org B',
      slug: 'org-b',
    });

    const user1Orgs = await user1.query(api.organizations.listByUser);
    expect(user1Orgs).toHaveLength(1);
    expect(user1Orgs[0]?.name).toBe('Org A');

    const user2Orgs = await user2.query(api.organizations.listByUser);
    expect(user2Orgs).toHaveLength(1);
    expect(user2Orgs[0]?.name).toBe('Org B');
  });
});

describe('organizations.get', () => {
  it('returns org for members', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    const orgId = await authed.mutation(api.organizations.create, {
      name: 'My Org',
      slug: 'my-org',
    });

    const org = await authed.query(api.organizations.get, { id: orgId });
    expect(org).toMatchObject({ name: 'My Org', slug: 'my-org' });
  });

  it('rejects non-members', async () => {
    const t = convexTest(schema);
    const { authed: user1 } = await setupUser(t, 'User 1');
    const { authed: user2 } = await setupUser(t, 'User 2');

    const orgId = await user1.mutation(api.organizations.create, {
      name: 'Private',
      slug: 'private',
    });

    await expect(
      user2.query(api.organizations.get, { id: orgId }),
    ).rejects.toThrow('Not a member of this organization');
  });
});

describe('organizations.update', () => {
  it('allows admin to update', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    const orgId = await authed.mutation(api.organizations.create, {
      name: 'Old Name',
      slug: 'old-slug',
    });

    await authed.mutation(api.organizations.update, {
      id: orgId,
      name: 'New Name',
    });

    const org = await authed.query(api.organizations.get, { id: orgId });
    expect(org?.name).toBe('New Name');
  });

  it('rejects members without admin role', async () => {
    const t = convexTest(schema);
    const { authed: owner } = await setupUser(t, 'Owner');
    const { userId: memberId, authed: member } = await setupUser(t, 'Member');

    const orgId = await owner.mutation(api.organizations.create, {
      name: 'Org',
      slug: 'org',
    });

    // Add member with 'member' role
    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: memberId,
        orgId,
        role: 'member',
      });
    });

    await expect(
      member.mutation(api.organizations.update, { id: orgId, name: 'Nope' }),
    ).rejects.toThrow('Requires admin role or higher');
  });
});

describe('organizations.remove', () => {
  it('allows owner to delete and cascades memberships', async () => {
    const t = convexTest(schema);
    const { authed } = await setupUser(t);

    const orgId = await authed.mutation(api.organizations.create, {
      name: 'To Delete',
      slug: 'to-delete',
    });

    await authed.mutation(api.organizations.remove, { id: orgId });

    const orgs = await authed.query(api.organizations.listByUser);
    expect(orgs).toHaveLength(0);

    // Memberships should be gone
    const memberships = await t.run(async (ctx) => {
      return await ctx.db
        .query('memberships')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect();
    });
    expect(memberships).toHaveLength(0);
  });

  it('rejects non-owners', async () => {
    const t = convexTest(schema);
    const { authed: owner } = await setupUser(t, 'Owner');
    const { userId: adminId, authed: admin } = await setupUser(t, 'Admin');

    const orgId = await owner.mutation(api.organizations.create, {
      name: 'Org',
      slug: 'org',
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: adminId,
        orgId,
        role: 'admin',
      });
    });

    await expect(
      admin.mutation(api.organizations.remove, { id: orgId }),
    ).rejects.toThrow('Requires owner role or higher');
  });
});
