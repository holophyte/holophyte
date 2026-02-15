// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

/** Create a user and return an authenticated test client + userId. */
async function setupUser(t: ReturnType<typeof convexTest>, name = 'Test User') {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert('users', { name });
  });
  return { userId, authed: t.withIdentity({ subject: `${userId}|s1` }) };
}

/** Create a user, org (as owner), and return everything needed. */
async function setupOwnerWithOrg(t: ReturnType<typeof convexTest>) {
  const { userId, authed } = await setupUser(t, 'Owner');
  const orgId = await authed.mutation(api.organizations.create, {
    name: 'Test Org',
    slug: 'test-org',
  });
  return { userId, authed, orgId };
}

describe('memberships.invite', () => {
  it('admin can invite a new member', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: newUserId } = await setupUser(t, 'New Member');

    await owner.mutation(api.memberships.invite, {
      orgId,
      userId: newUserId,
      role: 'member',
    });

    const members = await owner.query(api.memberships.listByOrg, { orgId });
    expect(members).toHaveLength(2);
    const invited = members.find((m) => m.userId === newUserId);
    expect(invited).toMatchObject({ role: 'member' });
  });

  it('requires admin role to invite', async () => {
    const t = convexTest(schema);
    const { orgId } = await setupOwnerWithOrg(t);
    const { userId: memberId, authed: member } = await setupUser(t, 'Member');
    const { userId: newUserId } = await setupUser(t, 'New');

    // Add user as a regular member
    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: memberId,
        orgId,
        role: 'member',
      });
    });

    await expect(
      member.mutation(api.memberships.invite, {
        orgId,
        userId: newUserId,
        role: 'viewer',
      }),
    ).rejects.toThrow('Requires admin role or higher');
  });

  it('admin cannot invite with owner role', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: adminId, authed: admin } = await setupUser(t, 'Admin');
    const { userId: newUserId } = await setupUser(t, 'New');

    // Add user as admin
    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: adminId,
        orgId,
        role: 'admin',
      });
    });

    await expect(
      admin.mutation(api.memberships.invite, {
        orgId,
        userId: newUserId,
        role: 'owner',
      }),
    ).rejects.toThrow('Only owners can assign the owner role');
  });

  it('rejects duplicate membership', async () => {
    const t = convexTest(schema);
    const {
      userId: ownerId,
      authed: owner,
      orgId,
    } = await setupOwnerWithOrg(t);

    await expect(
      owner.mutation(api.memberships.invite, {
        orgId,
        userId: ownerId,
        role: 'member',
      }),
    ).rejects.toThrow('User is already a member');
  });
});

describe('memberships.updateRole', () => {
  it('admin can change member role', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: memberId } = await setupUser(t, 'Member');

    const membershipId = await t.run(async (ctx) => {
      return await ctx.db.insert('memberships', {
        userId: memberId,
        orgId,
        role: 'member',
      });
    });

    await owner.mutation(api.memberships.updateRole, {
      id: membershipId,
      role: 'admin',
    });

    const members = await owner.query(api.memberships.listByOrg, { orgId });
    const updated = members.find((m) => m.userId === memberId);
    expect(updated).toMatchObject({ role: 'admin' });
  });

  it('admin cannot promote to owner', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: adminId, authed: admin } = await setupUser(t, 'Admin');
    const { userId: memberId } = await setupUser(t, 'Member');

    // Add admin and member
    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: adminId,
        orgId,
        role: 'admin',
      });
    });
    const membershipId = await t.run(async (ctx) => {
      return await ctx.db.insert('memberships', {
        userId: memberId,
        orgId,
        role: 'member',
      });
    });

    await expect(
      admin.mutation(api.memberships.updateRole, {
        id: membershipId,
        role: 'owner',
      }),
    ).rejects.toThrow('Only owners can promote to owner');
  });

  it('cannot demote an owner', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);

    // Add a second owner
    const { userId: owner2Id, authed: owner2 } = await setupUser(t, 'Owner 2');
    const owner2MembershipId = await t.run(async (ctx) => {
      return await ctx.db.insert('memberships', {
        userId: owner2Id,
        orgId,
        role: 'owner',
      });
    });

    // Get the first owner's membership
    const memberships = await owner.query(api.memberships.listByOrg, { orgId });
    const firstOwnerMembership = memberships.find(
      (m) => m.role === 'owner' && m.userId !== owner2Id,
    );

    // owner2 tries to demote original owner
    await expect(
      owner2.mutation(api.memberships.updateRole, {
        id: firstOwnerMembership!._id,
        role: 'admin',
      }),
    ).rejects.toThrow('Cannot change the role of an owner');
  });
});

describe('memberships.remove', () => {
  it('admin can remove a member', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: memberId } = await setupUser(t, 'Member');

    const membershipId = await t.run(async (ctx) => {
      return await ctx.db.insert('memberships', {
        userId: memberId,
        orgId,
        role: 'member',
      });
    });

    await owner.mutation(api.memberships.remove, { id: membershipId });

    const members = await owner.query(api.memberships.listByOrg, { orgId });
    expect(members).toHaveLength(1); // only owner remains
  });

  it('cannot remove an owner', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: owner2Id } = await setupUser(t, 'Owner 2');

    const owner2MembershipId = await t.run(async (ctx) => {
      return await ctx.db.insert('memberships', {
        userId: owner2Id,
        orgId,
        role: 'owner',
      });
    });

    await expect(
      owner.mutation(api.memberships.remove, { id: owner2MembershipId }),
    ).rejects.toThrow('Cannot remove an owner');
  });
});

describe('memberships.leave', () => {
  it('member can leave an org', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: memberId, authed: member } = await setupUser(t, 'Member');

    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: memberId,
        orgId,
        role: 'member',
      });
    });

    await member.mutation(api.memberships.leave, { orgId });

    const members = await owner.query(api.memberships.listByOrg, { orgId });
    expect(members).toHaveLength(1); // only owner remains
  });

  it('prevents last owner from leaving', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);

    await expect(
      owner.mutation(api.memberships.leave, { orgId }),
    ).rejects.toThrow('Cannot leave: you are the only owner');
  });

  it('allows owner to leave if other owners exist', async () => {
    const t = convexTest(schema);
    const { authed: owner1, orgId } = await setupOwnerWithOrg(t);
    const { userId: owner2Id, authed: owner2 } = await setupUser(t, 'Owner 2');

    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: owner2Id,
        orgId,
        role: 'owner',
      });
    });

    // owner1 can leave since owner2 exists
    await owner1.mutation(api.memberships.leave, { orgId });

    const members = await owner2.query(api.memberships.listByOrg, { orgId });
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe('owner');
  });
});
